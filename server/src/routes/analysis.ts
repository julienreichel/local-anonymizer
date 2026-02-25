import { FastifyInstance } from 'fastify'
import {
  ComprehendClient,
  DetectSentimentCommand,
  DetectToxicContentCommand,
  TextSegment,
} from '@aws-sdk/client-comprehend'
import { getDb } from '../db.js'
import { AppConfigSchema, AnalysisRequestSchema, okResponse, errResponse } from '@local-anonymizer/shared'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfig(db: ReturnType<typeof getDb>): z.infer<typeof AppConfigSchema> {
  const rows = db.prepare('SELECT key, value FROM app_config').all() as { key: string; value: string }[]
  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value)
    } catch {
      stored[row.key] = row.value
    }
  }
  return AppConfigSchema.parse(stored)
}

function buildComprehendClient(cfg: z.infer<typeof AppConfigSchema>): ComprehendClient {
  return new ComprehendClient({
    region: cfg.awsRegion || 'us-east-1',
    ...(cfg.awsAccessKeyId && cfg.awsSecretAccessKey
      ? {
          credentials: {
            accessKeyId: cfg.awsAccessKeyId,
            secretAccessKey: cfg.awsSecretAccessKey,
          },
        }
      : {}),
  })
}

/** Validate the X-API-Key header against the configured analysis API keys. */
function validateApiKey(
  key: string | undefined,
  validKeys: string[],
): boolean {
  if (validKeys.length === 0) return false
  if (!key) return false
  return validKeys.includes(key)
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ToxicityRequestSchema = AnalysisRequestSchema.omit({ languageCode: true })

export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/analysis/sentiment
  app.post<{ Body: z.infer<typeof AnalysisRequestSchema> }>(
    '/api/v1/analysis/sentiment',
    async (req, reply) => {
      const db = getDb()
      const cfg = getConfig(db)
      const apiKey = req.headers['x-api-key'] as string | undefined
      if (!validateApiKey(apiKey, cfg.analysisApiKeys)) {
        return reply.status(401).send(errResponse('UNAUTHORIZED', 'Invalid or missing X-API-Key'))
      }

      const parsed = AnalysisRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
      }

      if (!cfg.awsRegion) {
        return reply.status(503).send(errResponse('AWS_NOT_CONFIGURED', 'AWS region is not configured'))
      }

      const { messages, conversationId, languageCode } = parsed.data
      const client = buildComprehendClient(cfg)

      try {
        const results = await Promise.all(
          messages.map(async (msg) => {
            const cmd = new DetectSentimentCommand({
              Text: msg.content,
              LanguageCode: (languageCode ?? 'en') as 'en',
            })
            const resp = await client.send(cmd)
            return {
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp,
              sentiment: resp.Sentiment as 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED',
              scores: {
                Positive: resp.SentimentScore?.Positive ?? 0,
                Negative: resp.SentimentScore?.Negative ?? 0,
                Neutral: resp.SentimentScore?.Neutral ?? 0,
                Mixed: resp.SentimentScore?.Mixed ?? 0,
              },
            }
          }),
        )

        // Build summary
        const counts = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0, MIXED: 0 }
        for (const r of results) {
          if (r.sentiment in counts) counts[r.sentiment]++
        }
        const dominant = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0]) as
          | 'POSITIVE'
          | 'NEGATIVE'
          | 'NEUTRAL'
          | 'MIXED'

        return reply.send(
          okResponse({
            conversationId,
            results,
            summary: { dominant, counts },
          }),
        )
      } catch (err) {
        return reply
          .status(502)
          .send(errResponse('AWS_ERROR', (err as Error).message))
      }
    },
  )

  // POST /api/v1/analysis/toxicity
  app.post<{ Body: z.infer<typeof ToxicityRequestSchema> }>(
    '/api/v1/analysis/toxicity',
    async (req, reply) => {
      const db = getDb()
      const cfg = getConfig(db)
      const apiKey = req.headers['x-api-key'] as string | undefined
      if (!validateApiKey(apiKey, cfg.analysisApiKeys)) {
        return reply.status(401).send(errResponse('UNAUTHORIZED', 'Invalid or missing X-API-Key'))
      }

      const parsed = ToxicityRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send(errResponse('VALIDATION_ERROR', parsed.error.message))
      }

      if (!cfg.awsRegion) {
        return reply.status(503).send(errResponse('AWS_NOT_CONFIGURED', 'AWS region is not configured'))
      }

      const { messages, conversationId } = parsed.data
      const client = buildComprehendClient(cfg)

      try {
        // Batch messages in groups of 10 (Comprehend limit)
        const BATCH_SIZE = 10
        const allResults: Array<{
          role: 'user' | 'assistant' | 'system'
          content: string
          timestamp?: string
          toxicity: number
          labels: Array<{ name: string; score: number }>
        }> = []

        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
          const batch = messages.slice(i, i + BATCH_SIZE)
          const textSegments: TextSegment[] = batch.map((msg) => ({ Text: msg.content }))
          const cmd = new DetectToxicContentCommand({ TextSegments: textSegments, LanguageCode: 'en' })
          const resp = await client.send(cmd)

          for (let j = 0; j < batch.length; j++) {
            const msg = batch[j]!
            const item = resp.ResultList?.[j]
            allResults.push({
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp,
              toxicity: item?.Toxicity ?? 0,
              labels: (item?.Labels ?? []).map((l) => ({ name: l.Name ?? '', score: l.Score ?? 0 })),
            })
          }
        }

        const maxToxicity = allResults.reduce((max, r) => Math.max(max, r.toxicity), 0)
        const toxicMessageCount = allResults.filter((r) => r.toxicity > 0.5).length

        return reply.send(
          okResponse({
            conversationId,
            results: allResults,
            summary: { maxToxicity, toxicMessageCount },
          }),
        )
      } catch (err) {
        return reply
          .status(502)
          .send(errResponse('AWS_ERROR', (err as Error).message))
      }
    },
  )
}
