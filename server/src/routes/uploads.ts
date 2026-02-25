import { FastifyInstance } from 'fastify'
import { errResponse, hashString, okResponse } from '@local-anonymizer/shared'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getDb } from '../db.js'

function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? '/uploads'
}

const UploadBodySchema = z.object({
  fileName: z.string().min(1),
  content: z.string(),
})

function sanitizeFileName(input: string): string {
  const base = path.basename(input).replace(/\s+/g, '-')
  // Keep names simple and safe for local filesystem usage.
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_')
  return safe || `upload-${Date.now()}.json`
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: z.infer<typeof UploadBodySchema> }>('/api/uploads', async (req, reply) => {
    const parsed = UploadBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
    }

    const { fileName, content } = parsed.data
    const safeName = sanitizeFileName(fileName)
    const finalName = safeName.toLowerCase().endsWith('.json') ? safeName : `${safeName}.json`
    const uploadsDir = getUploadsDir()
    const targetPath = path.join(uploadsDir, finalName)
    const sourceFileName = `sha256:${hashString(content)}`
    const db = getDb()

    const delivered = db.prepare(`
      SELECT id FROM processing_runs
      WHERE source_file_name = ?
        AND status = 'delivered'
      LIMIT 1
    `).get(sourceFileName) as { id: string } | undefined

    if (delivered) {
      return reply.status(200).send(okResponse({
        fileName: finalName,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
        path: targetPath,
        sourceFileName,
        queued: false,
        reason: 'already_delivered',
      }))
    }

    const inProgress = db.prepare(`
      SELECT id FROM processing_runs
      WHERE source_file_name = ?
        AND status IN ('queued', 'processing', 'anonymized')
      LIMIT 1
    `).get(sourceFileName) as { id: string } | undefined

    if (inProgress) {
      return reply.status(200).send(okResponse({
        fileName: finalName,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
        path: targetPath,
        sourceFileName,
        queued: false,
        reason: 'already_queued',
      }))
    }

    try {
      await fs.mkdir(uploadsDir, { recursive: true })
      await fs.writeFile(targetPath, content, 'utf-8')
    } catch (err) {
      return reply
        .status(500)
        .send(errResponse('UPLOAD_WRITE_ERROR', (err as Error).message))
    }

    return reply.status(201).send(okResponse({
      fileName: finalName,
      bytesWritten: Buffer.byteLength(content, 'utf-8'),
      path: targetPath,
      sourceFileName,
      queued: true,
    }))
  })
}
