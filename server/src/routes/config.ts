import { FastifyInstance } from 'fastify'
import { getDb } from '../db.js'
import { AppConfigSchema } from '@local-anonymizer/shared'
import { z } from 'zod'

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/config – retrieve current config
  app.get('/api/config', async (_req, reply) => {
    const db = getDb()
    const rows = db.prepare('SELECT key, value FROM app_config').all() as {
      key: string
      value: string
    }[]
    const config: Record<string, string> = {}
    for (const row of rows) {
      config[row.key] = row.value
    }
    return reply.send({ success: true, data: config })
  })

  // PUT /api/config – update config (partial update supported)
  app.put<{ Body: Partial<z.infer<typeof AppConfigSchema>> }>(
    '/api/config',
    async (req, reply) => {
      const parsed = AppConfigSchema.partial().safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: parsed.error.message })
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
        ([k, v]) => [k, String(v)] as [string, string],
      )
      upsertMany(entries)
      return reply.send({ success: true, data: null })
    },
  )
}
