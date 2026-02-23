import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PresidioClient } from '../presidio-client.js'

// ── Mock global fetch ──────────────────────────────────────────────────────

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// ── Helpers ────────────────────────────────────────────────────────────────

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

function callBody(call: unknown[]): Record<string, unknown> {
  const opts = (call[1] ?? {}) as RequestInit
  return JSON.parse((opts.body ?? '{}') as string) as Record<string, unknown>
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PresidioClient', () => {
  const client = new PresidioClient('http://analyzer:5001', 'http://anonymizer:5002')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── analyze ─────────────────────────────────────────────────────────────

  describe('analyze', () => {
    it('posts to /analyze with text and language', async () => {
      const findings = [{ entity_type: 'PERSON', start: 0, end: 4, score: 0.85 }]
      fetchMock.mockResolvedValue(fakeResponse(findings))

      const result = await client.analyze('John', 'en')

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://analyzer:5001/analyze')
      expect(opts.method).toBe('POST')
      const body = JSON.parse(opts.body as string) as Record<string, unknown>
      expect(body).toMatchObject({ text: 'John', language: 'en' })
      expect(result).toEqual(findings)
    })

    it('includes entities filter when provided', async () => {
      fetchMock.mockResolvedValue(fakeResponse([]))

      await client.analyze('John', 'en', ['PERSON', 'EMAIL_ADDRESS'])

      const body = callBody(fetchMock.mock.calls[0] as unknown[])
      expect(body.entities).toEqual(['PERSON', 'EMAIL_ADDRESS'])
    })

    it('omits entities field when empty array provided', async () => {
      fetchMock.mockResolvedValue(fakeResponse([]))

      await client.analyze('John', 'en', [])

      const body = callBody(fetchMock.mock.calls[0] as unknown[])
      expect(body.entities).toBeUndefined()
    })

    it('includes score_threshold when provided', async () => {
      fetchMock.mockResolvedValue(fakeResponse([]))

      await client.analyze('John', 'en', undefined, 0.7)

      const body = callBody(fetchMock.mock.calls[0] as unknown[])
      expect(body.score_threshold).toBe(0.7)
    })

    it('throws when analyzer returns a non-ok response', async () => {
      fetchMock.mockResolvedValue(fakeResponse(null, false, 500))

      await expect(client.analyze('John', 'en')).rejects.toThrow('Presidio Analyzer HTTP 500')
    })
  })

  // ── anonymize ────────────────────────────────────────────────────────────

  describe('anonymize', () => {
    const findings = [{ entity_type: 'PERSON', start: 0, end: 4, score: 0.85 }]

    it('posts to /anonymize with text, analyzer_results, and anonymizers', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ text: '<PERSON>' }))

      const operators = { DEFAULT: { type: 'replace' as const } }
      const result = await client.anonymize('John', findings, operators)

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://anonymizer:5002/anonymize')
      expect(opts.method).toBe('POST')
      const body = JSON.parse(opts.body as string) as Record<string, unknown>
      expect(body.text).toBe('John')
      expect(body.analyzer_results).toEqual(findings)
      expect(body.anonymizers).toEqual(operators)
      expect(result).toBe('<PERSON>')
    })

    it('uses redact operator correctly', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ text: '' }))

      await client.anonymize('John', findings, { DEFAULT: { type: 'redact' } })

      const body = callBody(fetchMock.mock.calls[0] as unknown[])
      expect((body.anonymizers as Record<string, unknown>)).toEqual({ DEFAULT: { type: 'redact' } })
    })

    it('uses hash operator correctly', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ text: 'abc123' }))

      await client.anonymize('John', findings, { DEFAULT: { type: 'hash', hash_type: 'sha256' } })

      const body = callBody(fetchMock.mock.calls[0] as unknown[])
      expect((body.anonymizers as Record<string, unknown>)).toEqual({ DEFAULT: { type: 'hash', hash_type: 'sha256' } })
    })

    it('throws when anonymizer returns a non-ok response', async () => {
      fetchMock.mockResolvedValue(fakeResponse(null, false, 422))

      await expect(
        client.anonymize('John', findings, { DEFAULT: { type: 'replace' } }),
      ).rejects.toThrow('Presidio Anonymizer HTTP 422')
    })
  })
})
