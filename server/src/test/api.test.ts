import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { setDb, migrate } from '../db.js'
import { buildApp } from '../app.js'
import type { FastifyInstance } from 'fastify'

// Mock AWS Comprehend SDK for analysis route tests
vi.mock('@aws-sdk/client-comprehend', () => {
  const send = vi.fn()
  return {
    ComprehendClient: vi.fn(() => ({ send })),
    DetectSentimentCommand: vi.fn(),
    DetectToxicContentCommand: vi.fn(),
    __send: send,
  }
})

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

let app: FastifyInstance

beforeEach(async () => {
  // Use a fresh in-memory DB for each test
  const db = createTestDb()
  setDb(db)
  app = await buildApp()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; data: { status: string; services: Record<string, string> } }>()
    expect(body.ok).toBe(true)
    expect(body.data.status).toBe('ok')
    expect(body.data.services.api).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe('GET /api/config', () => {
  it('returns default config when empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; data: Record<string, unknown> }>()
    expect(body.ok).toBe(true)
    expect(body.data).toMatchObject({
      watchFolderPath: '/uploads',
      deleteAfterSuccess: false,
      deleteAfterFailure: false,
      maxFileSizeBytes: 10 * 1024 * 1024,
      acceptedExtensions: ['.json'],
      pollIntervalMs: 5000,
    })
  })
})

describe('PUT /api/config', () => {
  it('updates config fields', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { deleteAfterSuccess: true, pollIntervalMs: 3000 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; data: Record<string, unknown> }>()
    expect(body.ok).toBe(true)
    expect(body.data.deleteAfterSuccess).toBe(true)
    expect(body.data.pollIntervalMs).toBe(3000)
  })

  it('returns 400 on invalid data', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { maxFileSizeBytes: -1 },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json<{ ok: boolean; error: { code: string } }>()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })
})

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

describe('GET /api/targets', () => {
  it('returns empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/targets' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; data: unknown[] }>()
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([])
  })
})

describe('POST /api/targets', () => {
  it('creates a target', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/targets',
      payload: { name: 'My Target', url: 'https://example.com/webhook' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ ok: boolean; data: Record<string, unknown> }>()
    expect(body.ok).toBe(true)
    expect(body.data.id).toBeTruthy()
    expect(body.data.name).toBe('My Target')
    expect(body.data.url).toBe('https://example.com/webhook')
    expect(body.data.method).toBe('POST')
    expect(body.data.enabled).toBe(true)
  })

  it('returns 400 on missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/targets',
      payload: { name: 'No URL' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json<{ ok: boolean }>()
    expect(body.ok).toBe(false)
  })
})

describe('PUT /api/targets/:id', () => {
  it('updates an existing target', async () => {
    // Create
    const create = await app.inject({
      method: 'POST',
      url: '/api/targets',
      payload: { name: 'Original', url: 'https://example.com/hook' },
    })
    const id = create.json<{ data: { id: string } }>().data.id

    // Update
    const update = await app.inject({
      method: 'PUT',
      url: `/api/targets/${id}`,
      payload: { name: 'Updated', enabled: false },
    })
    expect(update.statusCode).toBe(200)
    const body = update.json<{ ok: boolean; data: Record<string, unknown> }>()
    expect(body.ok).toBe(true)
    expect(body.data.name).toBe('Updated')
    expect(body.data.enabled).toBe(false)
  })

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/targets/00000000-0000-0000-0000-000000000000',
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/targets/:id', () => {
  it('deletes an existing target', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/targets',
      payload: { name: 'To Delete', url: 'https://example.com' },
    })
    const id = create.json<{ data: { id: string } }>().data.id

    const del = await app.inject({ method: 'DELETE', url: `/api/targets/${id}` })
    expect(del.statusCode).toBe(200)
    expect(del.json<{ ok: boolean }>().ok).toBe(true)

    // Gone
    const list = await app.inject({ method: 'GET', url: '/api/targets' })
    expect(list.json<{ data: unknown[] }>().data).toHaveLength(0)
  })

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/targets/00000000-0000-0000-0000-000000000000',
    })
    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

describe('GET /api/runs', () => {
  it('returns empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; data: unknown[] }>()
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([])
  })

  it('filters by status', async () => {
    // Create two runs
    await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        sourceType: 'folderUpload',
        sourceFileName: 'sha256:abc',
        sourceFileSize: 1024,
        status: 'delivered',
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        sourceType: 'folderUpload',
        sourceFileName: 'sha256:def',
        sourceFileSize: 512,
        status: 'failed',
      },
    })

    const res = await app.inject({ method: 'GET', url: '/api/runs?status=delivered' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Array<{ status: string }> }>()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]!.status).toBe('delivered')
  })
})

describe('GET /api/runs/:id', () => {
  it('returns a specific run', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        sourceType: 'folderUpload',
        sourceFileName: 'sha256:abc123',
        sourceFileSize: 2048,
        status: 'processing',
      },
    })
    const id = create.json<{ data: { id: string } }>().data.id

    const res = await app.inject({ method: 'GET', url: `/api/runs/${id}` })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; data: Record<string, unknown> }>()
    expect(body.ok).toBe(true)
    expect(body.data.id).toBe(id)
    expect(body.data.status).toBe('processing')
  })

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs/00000000-0000-0000-0000-000000000000',
    })
    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Audit Logs
// ---------------------------------------------------------------------------

describe('GET /api/logs', () => {
  it('returns empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/logs' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; data: unknown[] }>()
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([])
  })

  it('filters by runId', async () => {
    const runCreate = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        sourceType: 'folderUpload',
        sourceFileName: 'sha256:xyz',
        sourceFileSize: 100,
        status: 'processing',
      },
    })
    const runId = runCreate.json<{ data: { id: string } }>().data.id

    // Add a log event for this run
    await app.inject({
      method: 'POST',
      url: '/api/logs',
      payload: { runId, eventType: 'anonymize_started', level: 'info' },
    })

    // Add an unrelated log event
    await app.inject({
      method: 'POST',
      url: '/api/logs',
      payload: { eventType: 'file_detected', level: 'info' },
    })

    const res = await app.inject({ method: 'GET', url: `/api/logs?runId=${runId}` })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: unknown[] }>()
    expect(body.data).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Analysis – sentinel / auth checks (no real AWS calls needed)
// ---------------------------------------------------------------------------

const ANALYSIS_MESSAGES = [
  { role: 'user', content: 'I love this product!' },
  { role: 'assistant', content: 'Thank you for your feedback.' },
]

describe('POST /api/v1/analysis/sentiment – auth & config validation', () => {
  it('returns 401 when X-API-Key header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/analysis/sentiment',
      payload: { messages: ANALYSIS_MESSAGES },
    })
    expect(res.statusCode).toBe(401)
    const body = res.json<{ ok: boolean; error: { code: string } }>()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when X-API-Key is invalid', async () => {
    // Set a valid API key in config
    await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { analysisApiKeys: ['valid-key-1'] },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/analysis/sentiment',
      payload: { messages: ANALYSIS_MESSAGES },
      headers: { 'x-api-key': 'wrong-key' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 503 when AWS region is not configured', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { analysisApiKeys: ['my-key'], awsRegion: '' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/analysis/sentiment',
      payload: { messages: ANALYSIS_MESSAGES },
      headers: { 'x-api-key': 'my-key' },
    })
    expect(res.statusCode).toBe(503)
    const body = res.json<{ ok: boolean; error: { code: string } }>()
    expect(body.error.code).toBe('AWS_NOT_CONFIGURED')
  })

  it('returns 400 on invalid request body', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { analysisApiKeys: ['my-key'] },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/analysis/sentiment',
      payload: { messages: [] }, // empty messages array violates min(1)
      headers: { 'x-api-key': 'my-key' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json<{ ok: boolean; error: { code: string } }>()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('POST /api/v1/analysis/toxicity – auth & config validation', () => {
  it('returns 401 when X-API-Key header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/analysis/toxicity',
      payload: { messages: ANALYSIS_MESSAGES },
    })
    expect(res.statusCode).toBe(401)
    const body = res.json<{ ok: boolean; error: { code: string } }>()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('returns 503 when AWS region is not configured', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { analysisApiKeys: ['tox-key'], awsRegion: '' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/analysis/toxicity',
      payload: { messages: ANALYSIS_MESSAGES },
      headers: { 'x-api-key': 'tox-key' },
    })
    expect(res.statusCode).toBe(503)
  })

  it('returns 400 on invalid request body', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { analysisApiKeys: ['tox-key'] },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/analysis/toxicity',
      payload: { messages: [] },
      headers: { 'x-api-key': 'tox-key' },
    })
    expect(res.statusCode).toBe(400)
  })
})
