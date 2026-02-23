/**
 * Worker PII leakage guard tests
 *
 * Verifies that the worker pipeline never sends raw PII (emails, phone numbers,
 * etc.) to the API in any PATCH/POST request body when processing the valid
 * fixture file.
 *
 * The fixture at fixtures/chat-valid.json contains:
 *   - Email:  john.smith@example.com
 *   - Phone:  +1-555-123-4567
 *   - SSN:    123-45-6789
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// ── Fixture & PII patterns ────────────────────────────────────────────────

const FIXTURE_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures')

const validFixtureRaw = readFileSync(join(FIXTURE_DIR, 'chat-valid.json'), 'utf-8')
const invalidFixtureRaw = readFileSync(join(FIXTURE_DIR, 'chat-invalid.json'), 'utf-8')

const PII_PATTERNS: RegExp[] = [
  /john\.smith@example\.com/i,
  /\+1-555-123-4567/,
  /123-45-6789/, // SSN
]

function containsPii(text: string): boolean {
  return PII_PATTERNS.some((re) => re.test(text))
}

// ── Helpers ───────────────────────────────────────────────────────────────

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function callUrl(call: unknown[]): string {
  return call[0] as string
}
function callOpts(call: unknown[]): RequestInit {
  return (call[1] ?? {}) as RequestInit
}

/**
 * Set up fetch so that Presidio analyze returns findings for each PII entity and
 * anonymize replaces the text, simulating real anonymization.
 */
function setupAnonymizingFetch() {
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
      return Promise.resolve(fakeResponse({ ok: true, data: { id: 'run-pii-1' } }, true, 201))
    }
    if ((method === 'PATCH' || method === 'POST') && url.includes('/api/runs/')) {
      return Promise.resolve(fakeResponse({ ok: true, data: null }))
    }
    if (method === 'POST' && url.includes('/api/logs')) {
      return Promise.resolve(fakeResponse({ ok: true, data: null }, true, 201))
    }
    if (method === 'POST' && url.includes('/analyze')) {
      // Return findings – positions don't matter for this test
      return Promise.resolve(fakeResponse([
        { entity_type: 'EMAIL_ADDRESS', start: 0, end: 26, score: 0.99 },
        { entity_type: 'PERSON', start: 27, end: 37, score: 0.95 },
      ]))
    }
    if (method === 'POST' && url.includes('/anonymize')) {
      // Return anonymized text with placeholders – no raw PII
      return Promise.resolve(fakeResponse({ text: 'Hi, my name is <PERSON>. You can reach me at <EMAIL_ADDRESS> or call <PHONE_NUMBER>.' }))
    }
    return Promise.resolve(fakeResponse({ ok: true, data: null }))
  })
}

async function importProcessor() {
  const mod = await import('../processor.js')
  return mod
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Worker PII leakage guard', () => {
  let fsMod: {
    stat: ReturnType<typeof vi.fn>
    readFile: ReturnType<typeof vi.fn>
    unlink: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const fsImport = await import('node:fs/promises')
    fsMod = fsImport.default as unknown as typeof fsMod
  })

  it('valid fixture passes schema validation', async () => {
    const { ChatLogSchema } = await import('@local-anonymizer/shared')
    expect(() => ChatLogSchema.parse(JSON.parse(validFixtureRaw))).not.toThrow()
  })

  it('invalid fixture fails schema validation', async () => {
    const { ChatLogSchema } = await import('@local-anonymizer/shared')
    expect(() => ChatLogSchema.parse(JSON.parse(invalidFixtureRaw))).toThrow()
  })

  it('no raw PII is sent to the API in any request body', async () => {
    setupAnonymizingFetch()
    fsMod.stat.mockResolvedValue({ size: validFixtureRaw.length })
    fsMod.readFile.mockResolvedValue(validFixtureRaw)

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat-valid.json')

    // Inspect every fetch call body for raw PII
    for (const call of fetchMock.mock.calls as unknown[][]) {
      const url = callUrl(call)
      const opts = callOpts(call)
      const body = (opts.body ?? '') as string

      // Only check API calls (not Presidio analyze/anonymize which receive raw text)
      if (!url.includes('/api/')) continue

      expect(containsPii(body)).toBe(false)
      // Also check the URL itself
      expect(containsPii(url)).toBe(false)
    }
  })

  it('no raw PII is present in run status PATCH bodies', async () => {
    setupAnonymizingFetch()
    fsMod.stat.mockResolvedValue({ size: validFixtureRaw.length })
    fsMod.readFile.mockResolvedValue(validFixtureRaw)

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat-valid.json')

    const patchCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (c) => callOpts(c).method === 'PATCH' && callUrl(c).includes('/api/runs/'),
    )
    expect(patchCalls.length).toBeGreaterThan(0)
    for (const call of patchCalls) {
      const body = (callOpts(call).body ?? '') as string
      expect(containsPii(body)).toBe(false)
    }
  })

  it('no raw PII is present in audit log POST bodies', async () => {
    setupAnonymizingFetch()
    fsMod.stat.mockResolvedValue({ size: validFixtureRaw.length })
    fsMod.readFile.mockResolvedValue(validFixtureRaw)

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat-valid.json')

    const logCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (c) => callOpts(c).method === 'POST' && callUrl(c).includes('/api/logs'),
    )
    expect(logCalls.length).toBeGreaterThan(0)
    for (const call of logCalls) {
      const body = (callOpts(call).body ?? '') as string
      expect(containsPii(body)).toBe(false)
    }
  })

  it('marks run as failed when given the invalid fixture (no PII leaks on failure)', async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      const method = opts?.method ?? 'GET'
      if (method === 'GET' && url.includes('/api/config')) {
        return Promise.resolve(fakeResponse({
          ok: true,
          data: { maxFileSizeBytes: 10 * 1024 * 1024, deleteAfterSuccess: false, deleteAfterFailure: false, anonymizationOperator: 'replace' },
        }))
      }
      if (method === 'POST' && url.includes('/api/runs') && !url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: { id: 'run-fail-1' } }, true, 201))
      }
      if ((method === 'PATCH' || method === 'POST') && url.includes('/api/runs/')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }))
      }
      if (method === 'POST' && url.includes('/api/logs')) {
        return Promise.resolve(fakeResponse({ ok: true, data: null }, true, 201))
      }
      return Promise.resolve(fakeResponse({ ok: true, data: null }))
    })

    fsMod.stat.mockResolvedValue({ size: invalidFixtureRaw.length })
    fsMod.readFile.mockResolvedValue(invalidFixtureRaw)

    const { processFile } = await importProcessor()
    await processFile('/uploads/chat-invalid.json')

    // The run should be marked failed
    const patchCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (c) => callOpts(c).method === 'PATCH' && callUrl(c).includes('/api/runs/'),
    )
    const failPatch = patchCalls.find((c) => {
      try {
        const b = JSON.parse((callOpts(c).body ?? '{}') as string) as { status?: string }
        return b.status === 'failed'
      } catch { return false }
    })
    expect(failPatch).toBeDefined()

    // No API call body should contain raw PII
    for (const call of fetchMock.mock.calls as unknown[][]) {
      const url = callUrl(call)
      if (!url.includes('/api/')) continue
      const body = (callOpts(call).body ?? '') as string
      expect(containsPii(body)).toBe(false)
    }
  })
})
