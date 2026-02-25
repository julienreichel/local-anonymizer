import { FastifyInstance } from 'fastify'
import { getDb } from '../db.js'
import {
  ProcessingRunSchema,
  ProcessingRunStatusSchema,
  okResponse,
  errResponse,
  nowIso,
} from '@local-anonymizer/shared'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RunRow = {
  id: string
  created_at: string
  updated_at: string
  source_type: string
  source_file_name: string
  source_file_size: number
  status: string
  error_code: string | null
  error_message_safe: string | null
  presidio_stats: string | null
  delivery_target_count: number | null
  delivery_success_count: number | null
  delivery_failure_count: number | null
  delivery_status_code: number | null
  delivery_duration_ms: number | null
  duration_ms: number | null
}

function rowToRun(row: RunRow): z.infer<typeof ProcessingRunSchema> {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceType: 'folderUpload',
    sourceFileName: row.source_file_name,
    sourceFileSize: row.source_file_size,
    status: row.status as z.infer<typeof ProcessingRunStatusSchema>,
    errorCode: row.error_code ?? undefined,
    errorMessageSafe: row.error_message_safe ?? undefined,
    presidioStats: row.presidio_stats
      ? (JSON.parse(row.presidio_stats) as Record<string, number>)
      : undefined,
    deliveryTargetCount: row.delivery_target_count ?? undefined,
    deliverySuccessCount: row.delivery_success_count ?? undefined,
    deliveryFailureCount: row.delivery_failure_count ?? undefined,
    deliveryStatusCode: row.delivery_status_code ?? undefined,
    deliveryDurationMs: row.delivery_duration_ms ?? undefined,
    durationMs: row.duration_ms ?? undefined,
  }
}

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  status: ProcessingRunStatusSchema.optional(),
  q: z.string().optional(),
})

const CreateBodySchema = ProcessingRunSchema.omit({ id: true, createdAt: true, updatedAt: true })

const UpdateBodySchema = z.object({
  status: ProcessingRunStatusSchema.optional(),
  errorCode: z.string().optional(),
  errorMessageSafe: z.string().optional(),
  presidioStats: z.record(z.number().int().nonnegative()).optional(),
  deliveryTargetCount: z.number().int().nonnegative().optional(),
  deliverySuccessCount: z.number().int().nonnegative().optional(),
  deliveryFailureCount: z.number().int().nonnegative().optional(),
  deliveryStatusCode: z.number().int().optional(),
  deliveryDurationMs: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
})

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/runs – list runs with optional filters
  app.get<{ Querystring: z.infer<typeof ListQuerySchema> }>('/api/runs', async (req, reply) => {
    const parsed = ListQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
    }
    const { limit, status, q } = parsed.data
    const db = getDb()

    let sql = 'SELECT * FROM processing_runs WHERE 1=1'
    const params: (string | number)[] = []

    if (status) {
      sql += ' AND status = ?'
      params.push(status)
    }
    if (q) {
      sql += ' AND source_file_name LIKE ?'
      params.push(`%${q}%`)
    }
    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const rows = db.prepare(sql).all(...params) as RunRow[]
    return reply.send(okResponse(rows.map(rowToRun)))
  })

  // GET /api/runs/:id – get a single run
  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM processing_runs WHERE id = ?')
      .get(req.params.id) as RunRow | undefined
    if (!row) {
      return reply.status(404).send(errResponse('NOT_FOUND', 'Run not found'))
    }
    return reply.send(okResponse(rowToRun(row)))
  })

  // POST /api/runs – create a run (called by the worker)
  app.post<{ Body: z.infer<typeof CreateBodySchema> }>('/api/runs', async (req, reply) => {
    const parsed = CreateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
    }
    const db = getDb()
    const now = nowIso()
    const id = uuidv4()
    const d = parsed.data
    db.prepare(`
      INSERT INTO processing_runs
        (id, created_at, updated_at, source_type, source_file_name, source_file_size, status,
         error_code, error_message_safe, presidio_stats,
         delivery_target_count, delivery_success_count, delivery_failure_count,
         delivery_status_code, delivery_duration_ms, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      now,
      now,
      d.sourceType,
      d.sourceFileName,
      d.sourceFileSize,
      d.status,
      d.errorCode ?? null,
      d.errorMessageSafe ?? null,
      d.presidioStats ? JSON.stringify(d.presidioStats) : null,
      d.deliveryTargetCount ?? null,
      d.deliverySuccessCount ?? null,
      d.deliveryFailureCount ?? null,
      d.deliveryStatusCode ?? null,
      d.deliveryDurationMs ?? null,
      d.durationMs ?? null,
    )
    return reply.status(201).send(okResponse({ id }))
  })

  // PATCH /api/runs/:id – update run status (called by the worker)
  app.patch<{ Params: { id: string }; Body: z.infer<typeof UpdateBodySchema> }>(
    '/api/runs/:id',
    async (req, reply) => {
      const parsed = UpdateBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
      }
      const db = getDb()
      const existing = db
        .prepare('SELECT * FROM processing_runs WHERE id = ?')
        .get(req.params.id) as RunRow | undefined
      if (!existing) {
        return reply.status(404).send(errResponse('NOT_FOUND', 'Run not found'))
      }
      const d = parsed.data
      const now = nowIso()
      db.prepare(`
        UPDATE processing_runs SET
          updated_at           = ?,
          status               = ?,
          error_code           = ?,
          error_message_safe   = ?,
          presidio_stats       = ?,
          delivery_target_count = ?,
          delivery_success_count = ?,
          delivery_failure_count = ?,
          delivery_status_code = ?,
          delivery_duration_ms = ?,
          duration_ms          = ?
        WHERE id = ?
      `).run(
        now,
        d.status ?? existing.status,
        d.errorCode ?? existing.error_code,
        d.errorMessageSafe ?? existing.error_message_safe,
        d.presidioStats !== undefined
          ? JSON.stringify(d.presidioStats)
          : existing.presidio_stats,
        d.deliveryTargetCount ?? existing.delivery_target_count,
        d.deliverySuccessCount ?? existing.delivery_success_count,
        d.deliveryFailureCount ?? existing.delivery_failure_count,
        d.deliveryStatusCode ?? existing.delivery_status_code,
        d.deliveryDurationMs ?? existing.delivery_duration_ms,
        d.durationMs ?? existing.duration_ms,
        req.params.id,
      )
      return reply.send(okResponse(null))
    },
  )
}
