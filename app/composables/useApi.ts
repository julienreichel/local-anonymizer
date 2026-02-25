import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schemas (mirroring shared/src/schemas.ts – kept light to avoid a dep)
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
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceType: z.literal('folderUpload'),
  sourceFileName: z.string(),
  sourceFileSize: z.number(),
  status: ProcessingRunStatusSchema,
  errorCode: z.string().optional(),
  errorMessageSafe: z.string().optional(),
  presidioStats: z.record(z.number()).optional(),
  deliveryStatusCode: z.number().optional(),
  deliveryDurationMs: z.number().optional(),
  durationMs: z.number().optional(),
})

export const AppConfigSchema = z.object({
  watchFolderPath: z.string().default('/uploads'),
  deleteAfterSuccess: z.boolean().default(false),
  deleteAfterFailure: z.boolean().default(false),
  maxFileSizeBytes: z.number().default(10 * 1024 * 1024),
  acceptedExtensions: z.array(z.string()).default(['.json']),
  pollIntervalMs: z.number().default(5000),
  anonymizationOperator: z.enum(['replace', 'redact', 'hash']).default('replace'),
  awsRegion: z.string().default(''),
  awsAccessKeyId: z.string().default(''),
  awsSecretAccessKey: z.string().default(''),
  analysisApiKeys: z.array(z.string()).default([]),
})

export const DeliveryTargetAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearerToken'), token: z.string() }),
  z.object({ type: z.literal('apiKeyHeader'), header: z.string(), key: z.string() }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
])

export const DeliveryTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  method: z.enum(['GET', 'POST']),
  headers: z.record(z.string()),
  auth: DeliveryTargetAuthSchema,
  timeoutMs: z.number(),
  retries: z.number(),
  backoffMs: z.number(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const AuditLogEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  runId: z.string().optional(),
  eventType: z.enum([
    'file_detected',
    'anonymize_started',
    'anonymize_succeeded',
    'delivery_started',
    'delivery_succeeded',
    'cleanup_deleted',
    'run_failed',
  ]),
  meta: z.record(z.unknown()).optional(),
})

export const HealthSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
  services: z
    .object({
      api: z.enum(['ok', 'error']),
      presidioAnalyzer: z.enum(['ok', 'error', 'unknown']),
      presidioAnonymizer: z.enum(['ok', 'error', 'unknown']),
    })
    .optional(),
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessingRun = z.infer<typeof ProcessingRunSchema>
export type AppConfig = z.infer<typeof AppConfigSchema>
export type DeliveryTarget = z.infer<typeof DeliveryTargetSchema>
export type AuditLogEvent = z.infer<typeof AuditLogEventSchema>
export type Health = z.infer<typeof HealthSchema>

// ---------------------------------------------------------------------------
// Response envelope helpers
// ---------------------------------------------------------------------------

const OkEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ ok: z.literal(true), data })

const ErrEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
})

function parseOk<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): z.infer<T> {
  const envelope = OkEnvelope(schema).safeParse(raw)
  if (!envelope.success) {
    const err = ErrEnvelope.safeParse(raw)
    if (err.success) throw new Error(`${err.data.error.code}: ${err.data.error.message}`)
    throw new Error(
      `Unexpected API response: ${envelope.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
    )
  }
  return envelope.data.data as z.infer<T>
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useApi() {
  const { apiBase } = useRuntimeConfig().public

  async function get<T extends z.ZodTypeAny>(path: string, schema: T): Promise<z.infer<T>> {
    const raw = await $fetch(`${apiBase}${path}`)
    return parseOk(schema, raw)
  }

  async function post<T extends z.ZodTypeAny>(
    path: string,
    body: Record<string, unknown>,
    schema: T,
  ): Promise<z.infer<T>> {
    const raw = await $fetch(`${apiBase}${path}`, { method: 'POST', body })
    return parseOk(schema, raw)
  }

  async function put<T extends z.ZodTypeAny>(
    path: string,
    body: Record<string, unknown>,
    schema: T,
  ): Promise<z.infer<T>> {
    const raw = await $fetch(`${apiBase}${path}`, { method: 'PUT', body })
    return parseOk(schema, raw)
  }

  async function patch<T extends z.ZodTypeAny>(
    path: string,
    body: Record<string, unknown>,
    schema: T,
  ): Promise<z.infer<T>> {
    const raw = await $fetch(`${apiBase}${path}`, { method: 'PATCH', body })
    return parseOk(schema, raw)
  }

  async function del(path: string): Promise<void> {
    await $fetch(`${apiBase}${path}`, { method: 'DELETE' })
  }

  return {
    // Health / status
    getHealth: () => get('/api/health', HealthSchema),

    // Config
    getConfig: () => get('/api/config', AppConfigSchema),
    updateConfig: (body: Partial<AppConfig>) =>
      put('/api/config', body as Record<string, unknown>, AppConfigSchema),

    // Targets
    getTargets: () => get('/api/targets', z.array(DeliveryTargetSchema)),
    createTarget: (body: Omit<DeliveryTarget, 'id' | 'createdAt' | 'updatedAt'>) =>
      post('/api/targets', body as Record<string, unknown>, DeliveryTargetSchema),
    updateTarget: (id: string, body: Partial<Omit<DeliveryTarget, 'id' | 'createdAt' | 'updatedAt'>>) =>
      put(`/api/targets/${id}`, body as Record<string, unknown>, DeliveryTargetSchema),
    deleteTarget: (id: string) => del(`/api/targets/${id}`),
    testTarget: (id: string) =>
      get(`/api/targets/${id}/test`, z.object({ statusCode: z.number(), ok: z.boolean() })),

    // Runs
    getRuns: (params?: { status?: string; q?: string; limit?: number }) => {
      const qs = new URLSearchParams()
      if (params?.status) qs.set('status', params.status)
      if (params?.q) qs.set('q', params.q)
      if (params?.limit) qs.set('limit', String(params.limit))
      const query = qs.toString()
      return get(`/api/runs${query ? `?${query}` : ''}`, z.array(ProcessingRunSchema))
    },
    getRun: (id: string) => get(`/api/runs/${id}`, ProcessingRunSchema),

    // Audit logs
    getLogs: (params?: { runId?: string; limit?: number }) => {
      const qs = new URLSearchParams()
      if (params?.runId) qs.set('runId', params.runId)
      if (params?.limit) qs.set('limit', String(params.limit))
      const query = qs.toString()
      return get(`/api/logs${query ? `?${query}` : ''}`, z.array(AuditLogEventSchema))
    },
  }
}
