import { FastifyInstance } from 'fastify'
import { getDb } from '../db.js'
import { AppConfigSchema, okResponse, errResponse } from '@local-anonymizer/shared'
import { z } from 'zod'

// Default config values (applied when key is missing from DB)
const DEFAULT_CONFIG = AppConfigSchema.parse({})

/** Read config rows from DB and merge with defaults. */
function readConfig(db: ReturnType<typeof getDb>): z.infer<typeof AppConfigSchema> {
  const rows = db.prepare('SELECT key, value FROM app_config').all() as {
    key: string
    value: string
  }[]
  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value)
    } catch {
      console.warn(`[config] Could not parse config key "${row.key}" as JSON, using raw string`)
      stored[row.key] = row.value
    }
  }
  return AppConfigSchema.parse({ ...DEFAULT_CONFIG, ...stored })
}

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/config – retrieve current config
  app.get('/api/config', async (_req, reply) => {
    const db = getDb()
    return reply.send(okResponse(readConfig(db)))
  })

  // PUT /api/config – update config (partial update supported)
  app.put<{ Body: Partial<z.infer<typeof AppConfigSchema>> }>(
    '/api/config',
    async (req, reply) => {
      const parsed = AppConfigSchema.partial().safeParse(req.body)
      if (!parsed.success) {
        return reply
          .status(400)
          .send(errResponse('VALIDATION_ERROR', parsed.error.message))
      }
      const db = getDb()
      const upsert = db.prepare(
        'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      const upsertMany = db.transaction((entries: [string, string][]) => {
        for (const [key, value] of entries) {
          upsert.run(key, value)
        }
      })
      const entries = Object.entries(parsed.data).map(
        ([k, v]) => [k, JSON.stringify(v)] as [string, string],
      )
      upsertMany(entries)
      return reply.send(okResponse(readConfig(db)))
    },
  )
}
