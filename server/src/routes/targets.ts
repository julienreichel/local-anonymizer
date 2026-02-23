import { FastifyInstance } from 'fastify'
import { getDb } from '../db.js'
import { DeliveryTargetSchema, okResponse, errResponse } from '@local-anonymizer/shared'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { nowIso } from '@local-anonymizer/shared'

type TargetRow = {
  id: string
  name: string
  url: string
  method: string
  headers: string
  auth: string
  timeout_ms: number
  retries: number
  backoff_ms: number
  enabled: number
  created_at: string
  updated_at: string
}

function rowToTarget(row: TargetRow): z.infer<typeof DeliveryTargetSchema> {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    method: row.method as 'GET' | 'POST',
    headers: JSON.parse(row.headers) as Record<string, string>,
    auth: JSON.parse(row.auth) as z.infer<typeof DeliveryTargetSchema>['auth'],
    timeoutMs: row.timeout_ms,
    retries: row.retries,
    backoffMs: row.backoff_ms,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const CreateBodySchema = DeliveryTargetSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})

const UpdateBodySchema = CreateBodySchema.partial()

export async function targetRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/targets – list all targets
  app.get('/api/targets', async (_req, reply) => {
    const db = getDb()
    const rows = db
      .prepare('SELECT * FROM delivery_targets ORDER BY created_at ASC')
      .all() as TargetRow[]
    return reply.send(okResponse(rows.map(rowToTarget)))
  })

  // POST /api/targets – create a target
  app.post<{ Body: z.infer<typeof CreateBodySchema> }>('/api/targets', async (req, reply) => {
    const parsed = CreateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
    }
    const db = getDb()
    const now = nowIso()
    const id = uuidv4()
    const d = parsed.data
    db.prepare(`
      INSERT INTO delivery_targets
        (id, name, url, method, headers, auth, timeout_ms, retries, backoff_ms, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      d.name,
      d.url,
      d.method ?? 'POST',
      JSON.stringify(d.headers ?? {}),
      JSON.stringify(d.auth ?? { type: 'none' }),
      d.timeoutMs ?? 15000,
      d.retries ?? 0,
      d.backoffMs ?? 1000,
      (d.enabled ?? true) ? 1 : 0,
      now,
      now,
    )
    const row = db
      .prepare('SELECT * FROM delivery_targets WHERE id = ?')
      .get(id) as TargetRow
    return reply.status(201).send(okResponse(rowToTarget(row)))
  })

  // PUT /api/targets/:id – update a target
  app.put<{ Params: { id: string }; Body: z.infer<typeof UpdateBodySchema> }>(
    '/api/targets/:id',
    async (req, reply) => {
      const parsed = UpdateBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
      }
      const db = getDb()
      const existing = db
        .prepare('SELECT * FROM delivery_targets WHERE id = ?')
        .get(req.params.id) as TargetRow | undefined
      if (!existing) {
        return reply.status(404).send(errResponse('NOT_FOUND', 'Target not found'))
      }
      const d = parsed.data
      const now = nowIso()
      db.prepare(`
        UPDATE delivery_targets SET
          name       = ?,
          url        = ?,
          method     = ?,
          headers    = ?,
          auth       = ?,
          timeout_ms = ?,
          retries    = ?,
          backoff_ms = ?,
          enabled    = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        d.name ?? existing.name,
        d.url ?? existing.url,
        d.method ?? existing.method,
        d.headers !== undefined ? JSON.stringify(d.headers) : existing.headers,
        d.auth !== undefined ? JSON.stringify(d.auth) : existing.auth,
        d.timeoutMs ?? existing.timeout_ms,
        d.retries ?? existing.retries,
        d.backoffMs ?? existing.backoff_ms,
        d.enabled !== undefined ? (d.enabled ? 1 : 0) : existing.enabled,
        now,
        req.params.id,
      )
      const updated = db
        .prepare('SELECT * FROM delivery_targets WHERE id = ?')
        .get(req.params.id) as TargetRow
      return reply.send(okResponse(rowToTarget(updated)))
    },
  )

  // DELETE /api/targets/:id – delete a target
  app.delete<{ Params: { id: string } }>('/api/targets/:id', async (req, reply) => {
    const db = getDb()
    const result = db
      .prepare('DELETE FROM delivery_targets WHERE id = ?')
      .run(req.params.id)
    if (result.changes === 0) {
      return reply.status(404).send(errResponse('NOT_FOUND', 'Target not found'))
    }
    return reply.send(okResponse(null))
  })

  // POST /api/targets/:id/test – send a minimal test payload (no PII)
  app.post<{ Params: { id: string } }>('/api/targets/:id/test', async (req, reply) => {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM delivery_targets WHERE id = ?')
      .get(req.params.id) as TargetRow | undefined
    if (!row) {
      return reply.status(404).send(errResponse('NOT_FOUND', 'Target not found'))
    }
    if (!row.enabled) {
      return reply.status(400).send(errResponse('TARGET_DISABLED', 'Target is disabled'))
    }

    const target = rowToTarget(row)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...target.headers,
    }

    // Apply auth headers
    const auth = target.auth
    if (auth.type === 'bearerToken') {
      headers['Authorization'] = `Bearer ${auth.token}`
    } else if (auth.type === 'apiKeyHeader') {
      headers[auth.header] = auth.key
    } else if (auth.type === 'basic') {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
      headers['Authorization'] = `Basic ${encoded}`
    }

    // Minimal test payload – no PII whatsoever
    const testPayload = {
      test: true,
      source: 'local-anonymizer',
      timestamp: new Date().toISOString(),
    }

    try {
      const res = await fetch(target.url, {
        method: target.method,
        headers,
        body: target.method === 'POST' ? JSON.stringify(testPayload) : undefined,
        signal: AbortSignal.timeout(target.timeoutMs),
      })
      return reply.send(
        okResponse({ statusCode: res.status, ok: res.ok }),
      )
    } catch (err) {
      return reply
        .status(502)
        .send(errResponse('DELIVERY_ERROR', (err as Error).message))
    }
  })
}
