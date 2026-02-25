import { z } from 'zod'

// ---------------------------------------------------------------------------
// Chat log file schema (uploaded JSON)
// ---------------------------------------------------------------------------

export const ChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system']).optional(),
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
  source_file_hash: z.string(), // SHA-256 of source file content
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
  method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
  headers: z.record(z.string()).default({}),
  auth: DeliveryTargetAuthSchema.default({ type: 'none' }),
  timeoutMs: z.number().int().positive().default(15000),
  retries: z.number().int().nonnegative().default(0),
  backoffMs: z.number().int().nonnegative().default(1000),
  enabled: z.boolean().default(true),
  /**
   * Optional JSON body template. String values of the form `${variable}` are
   * substituted with fields from the anonymized result before sending.
   *
   * Available variables: messages, source_file_hash, processed_at, byte_size, metadata
   *
   * Example:
   * {
   *   "messages":       "${messages}",
   *   "conversationId": "${source_file_hash}",
   *   "languageCode":   "en"
   * }
   *
   * When omitted the full AnonymizationResult object is sent as-is.
   */
  bodyTemplate: z.record(z.unknown()).optional(),
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
  deliveryTargetCount: z.number().int().nonnegative().optional(),
  deliverySuccessCount: z.number().int().nonnegative().optional(),
  deliveryFailureCount: z.number().int().nonnegative().optional(),
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
  'worker_heartbeat',
  'anonymize_started',
  'anonymize_succeeded',
  'delivery_started',
  'delivery_succeeded',
  'delivery_failed',
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
