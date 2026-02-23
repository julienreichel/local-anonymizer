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
// Anonymization result
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
// Processing log entry (stored in DB – no raw PII)
// ---------------------------------------------------------------------------

export const ProcessingStatusSchema = z.enum([
  'pending',
  'processing',
  'anonymized',
  'delivered',
  'failed',
])

export const LogEntrySchema = z.object({
  id: z.string().uuid(),
  file_name_hash: z.string(), // SHA-256 of original filename
  byte_size: z.number().int().nonnegative(),
  status: ProcessingStatusSchema,
  error_message: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

// ---------------------------------------------------------------------------
// App configuration (stored in DB / env)
// ---------------------------------------------------------------------------

export const AppConfigSchema = z.object({
  target_url: z.string().url(),
  target_auth_header: z.string().optional(), // e.g. "Bearer <token>"
  presidio_analyzer_url: z.string().url().default('http://presidio-analyzer:5001'),
  presidio_anonymizer_url: z.string().url().default('http://presidio-anonymizer:5002'),
  language: z.string().default('en'),
})

// ---------------------------------------------------------------------------
// API response wrappers
// ---------------------------------------------------------------------------

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type ChatLog = z.infer<typeof ChatLogSchema>
export type AnonymizedMessage = z.infer<typeof AnonymizedMessageSchema>
export type AnonymizationResult = z.infer<typeof AnonymizationResultSchema>
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>
export type LogEntry = z.infer<typeof LogEntrySchema>
export type AppConfig = z.infer<typeof AppConfigSchema>
