import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
  },
}))

// Mock global fetch
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a minimal valid chat log JSON string */
function chatLogJson(messages: { id: string; role: string; content: string }[] = []) {
  return JSON.stringify({ messages })
}

/** Build a fake Response */
function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** Extract URL and options from a fetchMock.mock.calls entry. */
function callUrl(call: unknown[]): string {
  return call[0] as string
}
function callOpts(call: unknown[]): RequestInit {
  return (call[1] ?? {}) as RequestInit
}
function callBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse((callOpts(call).body ?? '{}') as string) as Record<string, unknown>
}

// ── Default fetch mock factory ─────────────────────────────────────────────

/**
 * Wire up fetch to handle the standard happy-path sequence:
 *   1. GET /api/config   → default config
 *   2. POST /api/runs    → { id: 'run-1' }
 *   3. PATCH /api/runs/:id (queued→processing)
 *   4. POST /api/logs    (any number of times)
 *   5. POST /analyze     → []   (no PII)
 *   6. PATCH /api/runs/:id (anonymized)
 *   7. POST /api/logs    (anonymize_succeeded)
 *   8. POST /api/logs    (delivery_started)  – TARGET_URL empty → skip delivery
 */
function setupHappyPathFetch() {
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    const method = opts?.method ?? 'GET'

    if (method === 'GET' && url.includes('/api/config')) {
      return Promise.resolve(fakeResponse({
        ok: true,
        data: {
          maxFileSizeBytes: 10 * 1024 * 1024,
          deleteAfterSuccess: false,
          deleteAfterFailure: false,
          anonymizationOperator: 'replace',
        },
      }))
    }
    if (method === 'POST' && url.includes('/api/runs') && !url.includes('/api/runs/')) {
      return Promise.resolve(fakeResponse({ ok: true, data: { id: 'run-1' } }, true, 201))
    }
    if ((method === 'PATCH' || method === 'POST') && url.includes('/api/runs/')) {
      return Promise.resolve(fakeResponse({ ok: true, data: null }))
    }
    if (method === 'POST' && url.includes('/api/logs')) {
      return Promise.resolve(fakeResponse({ ok: true, data: null }, true, 201))
    }
    if (method === 'POST' && url.includes('/analyze')) {
      return Promise.resolve(fakeResponse([])) // no entities
    }
    if (method === 'POST' && url.includes('/anonymize')) {
      const body = JSON.parse((opts?.body ?? '{}') as string) as { text: string }
      return Promise.resolve(fakeResponse({ text: body.text }))
    }
    return Promise.resolve(fakeResponse({ ok: true, data: null }))
  })
}

// ── Import processFile after mocks are set up ────────────────────────────

// Dynamic import is used so the module picks up the vi.mock stubs above.
async function importProcessor() {
  const mod = await import('../processor.js')
  return mod
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('processFile', () => {
  let fsMod: { stat: ReturnType<typeof vi.fn>; readFile: ReturnType<typeof vi.fn>; unlink: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    // Get the mocked fs module
    const fsImport = await import('node:fs/promises')
    fsMod = fsImport.default as unknown as typeof fsMod
  })

  it('skips non-.json files', async () => {
    const { processFile } = await importProcessor()
    await processFile('/uploads/file.txt')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips files that exceed maxFileSizeBytes from config', async () => {
    // Override config to return a small max file size
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? 'GET'
      if (method === 'GET' && url.includes('/api/config')) {
        return Promise.resolve(fakeResponse({
          ok: true,
          data: { maxFileSizeBytes: 100, deleteAfterSuccess: false, deleteAfterFailure: false, anonymizationOperator: 'replace' },
        }))
      }
      return Promise.resolve(fakeResponse({ ok: true, data: null }))
    })

    fsMod.stat.mockResolvedValue({ size: 200 })

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    // No run should be created
    const runCreateCall = fetchMock.mock.calls.find(
      (c: unknown[]) => callOpts(c).method === 'POST' && callUrl(c).includes('/api/runs') && !callUrl(c).includes('/api/runs/'),
    )
    expect(runCreateCall).toBeUndefined()
  })

  it('creates run with queued status then transitions to processing', async () => {
    setupHappyPathFetch()
    fsMod.stat.mockResolvedValue({ size: 512 })
    fsMod.readFile.mockResolvedValue(chatLogJson([{ id: '1', role: 'user', content: 'hello' }]))

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    // First POST /api/runs should include status: 'queued'
    const createRunCall = fetchMock.mock.calls.find(
      (c: unknown[]) => callOpts(c).method === 'POST' && callUrl(c).includes('/api/runs') && !callUrl(c).includes('/api/runs/'),
    )
    expect(createRunCall).toBeDefined()
    expect(callBody(createRunCall!).status).toBe('queued')

    // Then PATCH /api/runs/run-1 to processing
    const processingPatch = fetchMock.mock.calls.find(
      (c: unknown[]) => callOpts(c).method === 'PATCH' && callUrl(c).includes('/api/runs/run-1'),
    )
    expect(processingPatch).toBeDefined()
    expect(callBody(processingPatch!).status).toBe('processing')
  })

  it('logs file_detected event after creating run', async () => {
    setupHappyPathFetch()
    fsMod.stat.mockResolvedValue({ size: 256 })
    fsMod.readFile.mockResolvedValue(chatLogJson([{ id: '1', role: 'user', content: 'hi' }]))

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    const logCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => callOpts(c).method === 'POST' && callUrl(c).includes('/api/logs'),
    )
    const eventTypes = logCalls.map((c: unknown[]) => callBody(c).eventType as string)
    expect(eventTypes).toContain('file_detected')
  })

  it('logs delivery_started event before delivery', async () => {
    setupHappyPathFetch()
    fsMod.stat.mockResolvedValue({ size: 256 })
    fsMod.readFile.mockResolvedValue(chatLogJson([{ id: '1', role: 'user', content: 'hi' }]))

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    const logCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => callOpts(c).method === 'POST' && callUrl(c).includes('/api/logs'),
    )
    const eventTypes = logCalls.map((c: unknown[]) => callBody(c).eventType as string)
    expect(eventTypes).toContain('delivery_started')
  })

  it('does not delete file when deleteAfterSuccess is false (default)', async () => {
    setupHappyPathFetch()
    fsMod.stat.mockResolvedValue({ size: 256 })
    fsMod.readFile.mockResolvedValue(chatLogJson([{ id: '1', role: 'user', content: 'hi' }]))
    fsMod.unlink.mockResolvedValue(undefined)

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    expect(fsMod.unlink).not.toHaveBeenCalled()
  })

  it('deletes file when deleteAfterSuccess is true', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? 'GET'
      if (method === 'GET' && url.includes('/api/config')) {
        return Promise.resolve(fakeResponse({
          ok: true,
          data: { maxFileSizeBytes: 10 * 1024 * 1024, deleteAfterSuccess: true, deleteAfterFailure: false, anonymizationOperator: 'replace' },
        }))
      }
      if (method === 'POST' && url.includes('/api/runs') && !url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: { id: 'run-1' } }, true, 201))
      }
      if ((method === 'PATCH' || method === 'POST') && url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }))
      }
      if (method === 'POST' && url.includes('/api/logs')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }, true, 201))
      }
      if (method === 'POST' && url.includes('/analyze')) {
        return Promise.resolve(fakeResponse([]))
      }
      return Promise.resolve(fakeResponse({ ok: true, data: null }))
    })

    fsMod.stat.mockResolvedValue({ size: 256 })
    fsMod.readFile.mockResolvedValue(chatLogJson([{ id: '1', role: 'user', content: 'hi' }]))
    fsMod.unlink.mockResolvedValue(undefined)

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    expect(fsMod.unlink).toHaveBeenCalledWith('/uploads/chat.json')
  })

  it('passes replace anonymizer to Presidio when operator is replace', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? 'GET'
      if (method === 'GET' && url.includes('/api/config')) {
        return Promise.resolve(fakeResponse({
          ok: true,
          data: { maxFileSizeBytes: 10 * 1024 * 1024, deleteAfterSuccess: false, deleteAfterFailure: false, anonymizationOperator: 'replace' },
        }))
      }
      if (method === 'POST' && url.includes('/api/runs') && !url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: { id: 'run-1' } }, true, 201))
      }
      if ((method === 'PATCH' || method === 'POST') && url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }))
      }
      if (method === 'POST' && url.includes('/api/logs')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }, true, 201))
      }
      if (method === 'POST' && url.includes('/analyze')) {
        return Promise.resolve(fakeResponse([{ entity_type: 'PERSON', start: 0, end: 4, score: 0.9 }]))
      }
      if (method === 'POST' && url.includes('/anonymize')) {
        return Promise.resolve(fakeResponse({ text: '<PERSON>' }))
      }
      return Promise.resolve(fakeResponse({ ok: true, data: null }))
    })

    fsMod.stat.mockResolvedValue({ size: 256 })
    fsMod.readFile.mockResolvedValue(chatLogJson([{ id: '1', role: 'user', content: 'John' }]))

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    const anonymizeCall = fetchMock.mock.calls.find(
      (c: unknown[]) => callOpts(c).method === 'POST' && callUrl(c).includes('/anonymize'),
    )
    expect(anonymizeCall).toBeDefined()
    expect((callBody(anonymizeCall!).anonymizers as Record<string, unknown>)).toEqual({ DEFAULT: { type: 'replace' } })
  })

  it('passes redact anonymizer to Presidio when operator is redact', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? 'GET'
      if (method === 'GET' && url.includes('/api/config')) {
        return Promise.resolve(fakeResponse({
          ok: true,
          data: { maxFileSizeBytes: 10 * 1024 * 1024, deleteAfterSuccess: false, deleteAfterFailure: false, anonymizationOperator: 'redact' },
        }))
      }
      if (method === 'POST' && url.includes('/api/runs') && !url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: { id: 'run-1' } }, true, 201))
      }
      if ((method === 'PATCH' || method === 'POST') && url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }))
      }
      if (method === 'POST' && url.includes('/api/logs')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }, true, 201))
      }
      if (method === 'POST' && url.includes('/analyze')) {
        return Promise.resolve(fakeResponse([{ entity_type: 'EMAIL_ADDRESS', start: 0, end: 15, score: 0.9 }]))
      }
      if (method === 'POST' && url.includes('/anonymize')) {
        return Promise.resolve(fakeResponse({ text: '' }))
      }
      return Promise.resolve(fakeResponse({ ok: true, data: null }))
    })

    fsMod.stat.mockResolvedValue({ size: 256 })
    fsMod.readFile.mockResolvedValue(chatLogJson([{ id: '1', role: 'user', content: 'test@example.com' }]))

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    const anonymizeCall = fetchMock.mock.calls.find(
      (c: unknown[]) => callOpts(c).method === 'POST' && callUrl(c).includes('/anonymize'),
    )
    expect(anonymizeCall).toBeDefined()
    expect((callBody(anonymizeCall!).anonymizers as Record<string, unknown>)).toEqual({ DEFAULT: { type: 'redact' } })
  })

  it('marks run as failed and does not delete file when JSON is invalid', async () => {
    setupHappyPathFetch()
    fsMod.stat.mockResolvedValue({ size: 64 })
    fsMod.readFile.mockResolvedValue('not valid json at all {{')
    fsMod.unlink.mockResolvedValue(undefined)

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    const patchCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) => callOpts(c).method === 'PATCH' && callUrl(c).includes('/api/runs/'),
    )
    const failPatch = patchCalls.find((c: unknown[]) => callBody(c).status === 'failed')
    expect(failPatch).toBeDefined()
    expect(fsMod.unlink).not.toHaveBeenCalled()
  })

  it('deletes file on failure when deleteAfterFailure is true', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? 'GET'
      if (method === 'GET' && url.includes('/api/config')) {
        return Promise.resolve(fakeResponse({
          ok: true,
          data: { maxFileSizeBytes: 10 * 1024 * 1024, deleteAfterSuccess: false, deleteAfterFailure: true, anonymizationOperator: 'replace' },
        }))
      }
      if (method === 'POST' && url.includes('/api/runs') && !url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: { id: 'run-1' } }, true, 201))
      }
      if ((method === 'PATCH' || method === 'POST') && url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }))
      }
      if (method === 'POST' && url.includes('/api/logs')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }, true, 201))
      }
      return Promise.resolve(fakeResponse({ ok: true, data: null }))
    })

    fsMod.stat.mockResolvedValue({ size: 64 })
    fsMod.readFile.mockResolvedValue('{"messages": "not-an-array"}')
    fsMod.unlink.mockResolvedValue(undefined)

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat.json')

    expect(fsMod.unlink).toHaveBeenCalledWith('/uploads/chat.json')
  })
})

