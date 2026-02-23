import { FastifyInstance } from 'fastify'
import { getDb } from '../db.js'
import { LogEntrySchema } from '@local-anonymizer/shared'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { nowIso } from '@local-anonymizer/shared'

export async function logRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/logs – list all log entries (newest first)
  app.get('/api/logs', async (_req, reply) => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM log_entries ORDER BY created_at DESC LIMIT 200').all()
    return reply.send({ success: true, data: rows })
  })

  // GET /api/logs/:id – single log entry
  app.get<{ Params: { id: string } }>('/api/logs/:id', async (req, reply) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM log_entries WHERE id = ?').get(req.params.id)
    if (!row) return reply.status(404).send({ success: false, error: 'Not found' })
    return reply.send({ success: true, data: row })
  })

  // POST /api/logs – create a log entry (called internally by the worker)
  const CreateBodySchema = LogEntrySchema.omit({ id: true, created_at: true, updated_at: true })
  app.post<{ Body: z.infer<typeof CreateBodySchema> }>('/api/logs', async (req, reply) => {
    const parsed = CreateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message })
    }
    const db = getDb()
    const now = nowIso()
    const id = uuidv4()
    db.prepare(`
      INSERT INTO log_entries (id, file_name_hash, byte_size, status, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      parsed.data.file_name_hash,
      parsed.data.byte_size,
      parsed.data.status,
      parsed.data.error_message ?? null,
      now,
      now,
    )
    return reply.status(201).send({ success: true, data: { id } })
  })

  // PATCH /api/logs/:id – update status (called internally by the worker)
  const UpdateBodySchema = z.object({
    status: LogEntrySchema.shape.status,
    error_message: z.string().optional(),
  })
  app.patch<{ Params: { id: string }; Body: z.infer<typeof UpdateBodySchema> }>(
    '/api/logs/:id',
    async (req, reply) => {
      const parsed = UpdateBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: parsed.error.message })
      }
      const db = getDb()
      const now = nowIso()
      const result = db
        .prepare(
          'UPDATE log_entries SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
        )
        .run(parsed.data.status, parsed.data.error_message ?? null, now, req.params.id)
      if (result.changes === 0) {
        return reply.status(404).send({ success: false, error: 'Not found' })
      }
      return reply.send({ success: true, data: null })
    },
  )
}
