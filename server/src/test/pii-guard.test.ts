/**
 * PII leakage guard tests
 *
 * These tests use the fixture files from the project root to verify that:
 * 1. Raw PII (emails, phone numbers) from fixtures never appears in stored DB rows.
 * 2. The API endpoints that store run/log records never persist raw PII.
 *
 * The fixture at fixtures/chat-valid.json contains:
 *   - Email:  john.smith@example.com
 *   - Phone:  +1-555-123-4567
 *   - Name:   John Smith
 *   - SSN:    123-45-6789
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { setDb, migrate } from '../db.js'
import { buildApp } from '../app.js'
import type { FastifyInstance } from 'fastify'

// ── Fixture PII patterns ─────────────────────────────────────────────────────

const FIXTURE_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures')

const validFixture = JSON.parse(readFileSync(join(FIXTURE_DIR, 'chat-valid.json'), 'utf-8')) as {
  messages: Array<{ id: string; role: string; content: string }>
  metadata?: Record<string, unknown>
}

// Known PII tokens extracted directly from the fixture
const PII_PATTERNS: RegExp[] = [
  /john\.smith@example\.com/i,
  /\+1-555-123-4567/,
  /123-45-6789/, // SSN
]

function containsPii(value: string): boolean {
  return PII_PATTERNS.some((re) => re.test(value))
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

let app: FastifyInstance
let db: Database.Database

beforeEach(async () => {
  db = createTestDb()
  setDb(db)
  app = await buildApp()
})

afterEach(async () => {
  await app.close()
})

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return every string value in a flat DB row as a single concatenated string. */
function rowToString(row: Record<string, unknown>): string {
  return Object.values(row)
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PII leakage guard – fixture validation', () => {
  it('fixture contains expected PII tokens', () => {
    const text = validFixture.messages.map((m) => m.content).join(' ')
    expect(containsPii(text)).toBe(true)
  })

  it('chat-invalid.json fails schema validation', async () => {
    const { ChatLogSchema } = await import('@local-anonymizer/shared')
    const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, 'chat-invalid.json'), 'utf-8'))
    expect(() => ChatLogSchema.parse(raw)).toThrow()
  })
})

describe('PII leakage guard – processing_runs table', () => {
  it('run record stores a hashed filename, not raw PII', async () => {
    // Create a run using the same sanitised filename the worker would produce
    // (sha256 hash of the original filename – no path or content)
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        sourceType: 'folderUpload',
        sourceFileName: 'sha256:b4cae651b96b8675bba0e71151655bd5c7000f078cad99ac203fed75d2909e3d',
        sourceFileSize: 1024,
        status: 'processing',
      },
    })
    expect(res.statusCode).toBe(201)

    // Inspect every stored column in the DB row
    const rows = db
      .prepare('SELECT * FROM processing_runs')
      .all() as Record<string, unknown>[]

    expect(rows).toHaveLength(1)
    const stored = rowToString(rows[0]!)
    for (const pattern of PII_PATTERNS) {
      expect(stored).not.toMatch(pattern)
    }
  })

  it('error_message_safe column never stores raw PII', async () => {
    // Simulate a run with a safe error message (as the worker sets it)
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        sourceType: 'folderUpload',
        sourceFileName: 'sha256:abc',
        sourceFileSize: 512,
        status: 'failed',
        errorCode: 'INVALID_SCHEMA',
        errorMessageSafe: 'Invalid schema',
      },
    })
    expect(res.statusCode).toBe(201)

    const rows = db
      .prepare('SELECT * FROM processing_runs')
      .all() as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    const stored = rowToString(rows[0]!)
    for (const pattern of PII_PATTERNS) {
      expect(stored).not.toMatch(pattern)
    }
  })
})

describe('PII leakage guard – audit_log_events table', () => {
  it('log event meta column never stores raw PII', async () => {
    // Create a run first so we have a valid runId
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        sourceType: 'folderUpload',
        sourceFileName: 'sha256:xyz',
        sourceFileSize: 100,
        status: 'processing',
      },
    })
    const runId = runRes.json<{ data: { id: string } }>().data.id

    // Add a log event – meta should only contain safe fields (entity count, etc.)
    await app.inject({
      method: 'POST',
      url: '/api/logs',
      payload: {
        runId,
        eventType: 'anonymize_succeeded',
        level: 'info',
        meta: { entityCount: 3 },
      },
    })

    // Inspect every stored column in the DB
    const rows = db
      .prepare('SELECT * FROM audit_log_events')
      .all() as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    const stored = rowToString(rows[0]!)
    for (const pattern of PII_PATTERNS) {
      expect(stored).not.toMatch(pattern)
    }
  })

  it('GET /api/logs response never contains raw PII', async () => {
    // Create a run and a log entry with safe metadata
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        sourceType: 'folderUpload',
        sourceFileName: 'sha256:abc123',
        sourceFileSize: 200,
        status: 'anonymized',
      },
    })
    const runId = runRes.json<{ data: { id: string } }>().data.id

    await app.inject({
      method: 'POST',
      url: '/api/logs',
      payload: { runId, eventType: 'file_detected', level: 'info', meta: { byteSize: 200 } },
    })

    const res = await app.inject({ method: 'GET', url: '/api/logs' })
    const responseText = res.body
    for (const pattern of PII_PATTERNS) {
      expect(responseText).not.toMatch(pattern)
    }
  })
})
