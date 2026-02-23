import { FastifyInstance } from 'fastify'
import { getDb } from '../db.js'
import { AuditLogEventSchema, okResponse, errResponse, nowIso } from '@local-anonymizer/shared'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type AuditRow = {
  id: string
  timestamp: string
  level: string
  run_id: string | null
  event_type: string
  meta: string | null
}

function rowToEvent(row: AuditRow): z.infer<typeof AuditLogEventSchema> {
  return {
    id: row.id,
    timestamp: row.timestamp,
    level: row.level as z.infer<typeof AuditLogEventSchema>['level'],
    runId: row.run_id ?? undefined,
    eventType: row.event_type as z.infer<typeof AuditLogEventSchema>['eventType'],
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : undefined,
  }
}

const ListQuerySchema = z.object({
  runId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
})

const CreateBodySchema = AuditLogEventSchema.omit({ id: true, timestamp: true })

export async function logRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/logs – list audit log events (newest first)
  app.get<{ Querystring: z.infer<typeof ListQuerySchema> }>('/api/logs', async (req, reply) => {
    const parsed = ListQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
    }
    const { runId, limit } = parsed.data
    const db = getDb()

    let sql = 'SELECT * FROM audit_log_events WHERE 1=1'
    const params: (string | number)[] = []

    if (runId) {
      sql += ' AND run_id = ?'
      params.push(runId)
    }
    sql += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(limit)

    const rows = db.prepare(sql).all(...params) as AuditRow[]
    return reply.send(okResponse(rows.map(rowToEvent)))
  })

  // POST /api/logs – append an audit log event (called by the worker)
  app.post<{ Body: z.infer<typeof CreateBodySchema> }>('/api/logs', async (req, reply) => {
    const parsed = CreateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
    }
    const db = getDb()
    const id = uuidv4()
    const now = nowIso()
    const d = parsed.data
    db.prepare(`
      INSERT INTO audit_log_events (id, timestamp, level, run_id, event_type, meta)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      now,
      d.level,
      d.runId ?? null,
      d.eventType,
      d.meta ? JSON.stringify(d.meta) : null,
    )
    return reply.status(201).send(okResponse({ id }))
  })
}
