import { z } from 'zod'

// ---------------------------------------------------------------------------
// Chat log file schema (uploaded JSON)
// ---------------------------------------------------------------------------

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().datetime().optional(),
})

export const ChatLogSchema = z.object({
  version: z.string().optional(),
  messages: z.array(ChatMessageSchema),
  metadata: z.record(z.unknown()).optional(),
})

// ---------------------------------------------------------------------------
// Anonymization result (in-memory / delivery payload – never stored raw)
// ---------------------------------------------------------------------------

export const AnonymizedMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(), // PII replaced
  timestamp: z.string().datetime().optional(),
  entities_found: z.number().int().nonnegative(),
})

export const AnonymizationResultSchema = z.object({
  source_file_hash: z.string(), // SHA-256 of original filename (not content)
  byte_size: z.number().int().nonnegative(),
  processed_at: z.string().datetime(),
  messages: z.array(AnonymizedMessageSchema),
  metadata: z.record(z.unknown()).optional(),
})

// ---------------------------------------------------------------------------
// AppConfig (singleton – stored in DB as key/value)
// ---------------------------------------------------------------------------

export const AnonymizationOperatorSchema = z.enum(['replace', 'redact', 'hash'])

export const AppConfigSchema = z.object({
  watchFolderPath: z.string().default('/uploads'),
  deleteAfterSuccess: z.boolean().default(false),
  deleteAfterFailure: z.boolean().default(false),
  maxFileSizeBytes: z.number().int().positive().default(10 * 1024 * 1024),
  acceptedExtensions: z.array(z.string()).default(['.json']),
  pollIntervalMs: z.number().int().positive().default(5000),
  anonymizationOperator: AnonymizationOperatorSchema.default('replace'),
  // Analysis (Amazon Comprehend) settings
  awsRegion: z.string().default(''),
  awsAccessKeyId: z.string().default(''),
  awsSecretAccessKey: z.string().default(''),
  analysisApiKeys: z.array(z.string()).default([]),
})

// ---------------------------------------------------------------------------
// Analysis request / response schemas
// ---------------------------------------------------------------------------

export const AnalysisMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().datetime().optional(),
})

export const AnalysisRequestSchema = z.object({
  messages: z.array(AnalysisMessageSchema).min(1),
  conversationId: z.string().optional(),
  languageCode: z.string().default('en'),
  model: z.string().optional(),
  channel: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export const SentimentScoresSchema = z.object({
  Positive: z.number(),
  Negative: z.number(),
  Neutral: z.number(),
  Mixed: z.number(),
})

export const SentimentResultSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().optional(),
  sentiment: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED']),
  scores: SentimentScoresSchema,
})

export const SentimentSummarySchema = z.object({
  dominant: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED']),
  counts: z.object({
    POSITIVE: z.number(),
    NEGATIVE: z.number(),
    NEUTRAL: z.number(),
    MIXED: z.number(),
  }),
})

export const SentimentResponseSchema = z.object({
  conversationId: z.string().optional(),
  results: z.array(SentimentResultSchema),
  summary: SentimentSummarySchema,
})

export const ToxicityLabelSchema = z.object({
  name: z.string(),
  score: z.number(),
})

export const ToxicityResultSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().optional(),
  toxicity: z.number(),
  labels: z.array(ToxicityLabelSchema),
})

export const ToxicitySummarySchema = z.object({
  maxToxicity: z.number(),
  toxicMessageCount: z.number(),
})

export const ToxicityResponseSchema = z.object({
  conversationId: z.string().optional(),
  results: z.array(ToxicityResultSchema),
  summary: ToxicitySummarySchema,
})

// ---------------------------------------------------------------------------
// DeliveryTarget
// ---------------------------------------------------------------------------

export const DeliveryTargetAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearerToken'), token: z.string() }),
  z.object({ type: z.literal('apiKeyHeader'), header: z.string(), key: z.string() }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
])

export const DeliveryTargetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('POST'),
  headers: z.record(z.string()).default({}),
  auth: DeliveryTargetAuthSchema.default({ type: 'none' }),
  timeoutMs: z.number().int().positive().default(15000),
  retries: z.number().int().nonnegative().default(0),
  backoffMs: z.number().int().nonnegative().default(1000),
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

// ---------------------------------------------------------------------------
// ProcessingRun (stored in DB – no raw PII)
// ---------------------------------------------------------------------------

export const ProcessingRunStatusSchema = z.enum([
  'queued',
  'processing',
  'anonymized',
  'delivered',
  'failed',
  'deleted',
])

export const ProcessingRunSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  sourceType: z.literal('folderUpload'),
  sourceFileName: z.string(), // sanitized name + hash – no raw path
  sourceFileSize: z.number().int().nonnegative(),
  status: ProcessingRunStatusSchema,
  errorCode: z.string().optional(),
  errorMessageSafe: z.string().optional(),
  presidioStats: z.record(z.number().int().nonnegative()).optional(),
  deliveryStatusCode: z.number().int().optional(),
  deliveryDurationMs: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
})

// ---------------------------------------------------------------------------
// AuditLogEvent (append-only – no payload content)
// ---------------------------------------------------------------------------

export const AuditLogEventLevelSchema = z.enum(['info', 'warn', 'error'])

export const AuditLogEventTypeSchema = z.enum([
  'file_detected',
  'anonymize_started',
  'anonymize_succeeded',
  'delivery_started',
  'delivery_succeeded',
  'cleanup_deleted',
  'run_failed',
])

export const AuditLogEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  level: AuditLogEventLevelSchema,
  runId: z.string().uuid().optional(),
  eventType: AuditLogEventTypeSchema,
  meta: z.record(z.unknown()).optional(), // safe metadata – no payload content
})

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------

export const okResponse = <T>(data: T) => ({ ok: true as const, data })
export const errResponse = (code: string, message: string) =>
  ({ ok: false as const, error: { code, message } }) as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type ChatLog = z.infer<typeof ChatLogSchema>
export type AnonymizedMessage = z.infer<typeof AnonymizedMessageSchema>
export type AnonymizationResult = z.infer<typeof AnonymizationResultSchema>
export type AnonymizationOperator = z.infer<typeof AnonymizationOperatorSchema>
export type AppConfig = z.infer<typeof AppConfigSchema>
export type DeliveryTargetAuth = z.infer<typeof DeliveryTargetAuthSchema>
export type DeliveryTarget = z.infer<typeof DeliveryTargetSchema>
export type ProcessingRunStatus = z.infer<typeof ProcessingRunStatusSchema>
export type ProcessingRun = z.infer<typeof ProcessingRunSchema>
export type AuditLogEventLevel = z.infer<typeof AuditLogEventLevelSchema>
export type AuditLogEventType = z.infer<typeof AuditLogEventTypeSchema>
export type AuditLogEvent = z.infer<typeof AuditLogEventSchema>
export type AnalysisMessage = z.infer<typeof AnalysisMessageSchema>
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>
export type SentimentResult = z.infer<typeof SentimentResultSchema>
export type SentimentResponse = z.infer<typeof SentimentResponseSchema>
export type ToxicityResult = z.infer<typeof ToxicityResultSchema>
export type ToxicityResponse = z.infer<typeof ToxicityResponseSchema>
