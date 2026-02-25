import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ChatLogSchema,
  ACCEPTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  DELIVERY_TIMEOUT_MS,
  hashString,
  nowIso,
  type AnonymizationResult,
  type AnonymizedMessage,
  type AnonymizationOperator,
} from '@local-anonymizer/shared'
import { PresidioClient, type PresidioOperatorsMap } from './presidio-client.js'
import { logger } from './logger.js'

const ANALYZER_URL = process.env.PRESIDIO_ANALYZER_URL ?? 'http://presidio-analyzer:5001'
const ANONYMIZER_URL = process.env.PRESIDIO_ANONYMIZER_URL ?? 'http://presidio-anonymizer:5002'

const presidio = new PresidioClient(ANALYZER_URL, ANONYMIZER_URL)
const TARGET_URL = process.env.TARGET_URL ?? ''
const TARGET_AUTH_HEADER = process.env.TARGET_AUTH_HEADER ?? ''
const API_URL = process.env.API_URL ?? 'http://api:3001'
const LANGUAGE = process.env.LANGUAGE ?? 'en'

// ── Config helper ────────────────────────────────────────────────────────────

interface WorkerConfig {
  maxFileSizeBytes: number
  deleteAfterSuccess: boolean
  deleteAfterFailure: boolean
  anonymizationOperator: AnonymizationOperator
  analysisServiceUrl?: string
  analysisServiceApiKey?: string
  analysisServiceSentimentEnabled: boolean
  analysisServiceToxicityEnabled: boolean
  analysisServiceLanguageCode: string
  analysisServiceModel?: string
  analysisServiceChannel?: string
  analysisServiceTags?: string[]
}

async function getConfig(): Promise<WorkerConfig> {
  try {
    const res = await fetch(`${API_URL}/api/config`)
    const json = (await res.json()) as {
      ok: boolean
      data: WorkerConfig
    }
    return {
      maxFileSizeBytes: json.data.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES,
      deleteAfterSuccess: json.data.deleteAfterSuccess ?? false,
      deleteAfterFailure: json.data.deleteAfterFailure ?? false,
      anonymizationOperator: json.data.anonymizationOperator ?? 'replace',
      analysisServiceUrl: json.data.analysisServiceUrl,
      analysisServiceApiKey: json.data.analysisServiceApiKey,
      analysisServiceSentimentEnabled: json.data.analysisServiceSentimentEnabled ?? false,
      analysisServiceToxicityEnabled: json.data.analysisServiceToxicityEnabled ?? false,
      analysisServiceLanguageCode: json.data.analysisServiceLanguageCode ?? 'en',
      analysisServiceModel: json.data.analysisServiceModel,
      analysisServiceChannel: json.data.analysisServiceChannel,
      analysisServiceTags: json.data.analysisServiceTags,
    }
  } catch {
    // Fall back to safe defaults if the API is unavailable
    return {
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      deleteAfterSuccess: false,
      deleteAfterFailure: false,
      anonymizationOperator: 'replace',
      analysisServiceSentimentEnabled: false,
      analysisServiceToxicityEnabled: false,
      analysisServiceLanguageCode: 'en',
    }
  }
}

// ── API helpers ─────────────────────────────────────────────────────────────

async function createRun(
  sourceFileName: string,
  sourceFileSize: number,
  status: string,
): Promise<string> {
  const res = await fetch(`${API_URL}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceType: 'folderUpload',
      sourceFileName,
      sourceFileSize,
      status,
    }),
  })
  const json = (await res.json()) as { ok: boolean; data: { id: string } }
  return json.data.id
}

async function updateRun(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await fetch(`${API_URL}/api/runs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
}

async function appendLog(
  runId: string | undefined,
  eventType: string,
  level: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await fetch(`${API_URL}/api/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, eventType, level, meta }),
  }).catch(() => {
    // Audit log failures are non-fatal
  })
}

// ── Presidio helpers ────────────────────────────────────────────────────────

/** Build the Presidio anonymizers map based on the configured operator. */
function buildAnonymizers(operator: AnonymizationOperator): PresidioOperatorsMap {
  switch (operator) {
    case 'redact':
      return { DEFAULT: { type: 'redact' } }
    case 'hash':
      return { DEFAULT: { type: 'hash', hash_type: 'sha256' } }
    default: // 'replace' – replace each entity with its <ENTITY_TYPE> label
      return { DEFAULT: { type: 'replace' } }
  }
}

// ── Delivery helper ─────────────────────────────────────────────────────────

async function deliverPayload(payload: AnonymizationResult): Promise<number | null> {
  if (!TARGET_URL) {
    logger.warn('delivery_skipped', { reason: 'TARGET_URL_not_set' })
    return null
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (TARGET_AUTH_HEADER) headers['Authorization'] = TARGET_AUTH_HEADER
  const res = await fetch(TARGET_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Delivery target HTTP ${res.status}`)
  return res.status
}

// ── Analysis service helper ─────────────────────────────────────────────────

interface AnalysisPayload {
  messages: Array<{ role: string; content: string; timestamp?: string }>
  conversationId?: string
  languageCode?: string
  model?: string
  channel?: string
  tags?: string[]
}

async function callAnalysisEndpoint(
  url: string,
  payload: AnalysisPayload,
  apiKey: string,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Analysis service HTTP ${res.status}`)
}

// ── File processing ─────────────────────────────────────────────────────────

export async function processFile(filePath: string): Promise<void> {
  const fileName = path.basename(filePath)
  const ext = path.extname(fileName).toLowerCase()

  if (!ACCEPTED_EXTENSIONS.includes(ext as '.json')) {
    logger.info('file_skipped', { reason: 'non_json_extension' })
    return
  }

  // Fetch runtime config from the API (falls back to safe defaults)
  const config = await getConfig()

  let byteSize = 0
  try {
    const stat = await fs.stat(filePath)
    byteSize = stat.size
  } catch {
    // File may have been removed already
    return
  }

  if (byteSize > config.maxFileSizeBytes) {
    logger.warn('file_skipped', { reason: 'file_too_large', byteSize, maxFileSizeBytes: config.maxFileSizeBytes })
    return
  }

  // Store only a sanitized reference: hash of filename – no raw path or content
  const fileNameHash = hashString(fileName)
  const sourceFileName = `sha256:${fileNameHash}`
  logger.info('file_detected', { fileHash: fileNameHash, byteSize })

  const startMs = Date.now()
  let runId: string | null = null

  // ── Step 1: Create run record as "queued" ──────────────────────────────
  try {
    runId = await createRun(sourceFileName, byteSize, 'queued')
    await appendLog(runId, 'file_detected', 'info', { byteSize })
  } catch (e) {
    logger.error('run_create_failed', { errorMessage: (e as Error).message })
  }

  // ── Step 2: Begin processing ───────────────────────────────────────────
  if (runId) {
    try {
      await updateRun(runId, { status: 'processing' })
      await appendLog(runId, 'anonymize_started', 'info')
    } catch (e) {
      logger.error('run_status_update_failed', { runId: runId ?? undefined, errorMessage: (e as Error).message })
    }
  }

  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf-8')
  } catch {
    if (runId) {
      await updateRun(runId, { status: 'failed', errorCode: 'READ_ERROR', errorMessageSafe: 'Could not read file' })
      await appendLog(runId, 'run_failed', 'error', { errorCode: 'READ_ERROR' })
    }
    if (config.deleteAfterFailure) {
      await fs.unlink(filePath).catch(() => {})
    }
    return
  }

  // Parse chat log
  let chatLog: ReturnType<typeof ChatLogSchema.parse>
  try {
    chatLog = ChatLogSchema.parse(JSON.parse(raw))
  } catch (e) {
    logger.error('schema_validation_failed', { runId: runId ?? undefined, fileHash: fileNameHash, errorCode: 'INVALID_SCHEMA' })
    if (runId) {
      await updateRun(runId, { status: 'failed', errorCode: 'INVALID_SCHEMA', errorMessageSafe: 'Invalid schema' })
      await appendLog(runId, 'run_failed', 'error', { errorCode: 'INVALID_SCHEMA' })
    }
    if (config.deleteAfterFailure) {
      await fs.unlink(filePath).catch(() => {})
    }
    return
  }

  // ── Step 3: Anonymize each message ─────────────────────────────────────
  const anonymizedMessages: AnonymizedMessage[] = []
  const presidioStats: Record<string, number> = {}

  for (const msg of chatLog.messages) {
    try {
      const analysisResults = await presidio.analyze(msg.content, LANGUAGE)
      const anonymizedContent = analysisResults.length > 0
        ? await presidio.anonymize(msg.content, analysisResults, buildAnonymizers(config.anonymizationOperator))
        : msg.content
      anonymizedMessages.push({
        id: msg.id,
        role: msg.role,
        content: anonymizedContent,
        timestamp: msg.timestamp,
        entities_found: analysisResults.length,
      })
      for (const r of analysisResults) {
        presidioStats[r.entity_type] = (presidioStats[r.entity_type] ?? 0) + 1
      }
    } catch (e) {
      logger.error('presidio_error', { runId: runId ?? undefined, fileHash: fileNameHash, errorMessage: (e as Error).message })
      if (runId) {
        await updateRun(runId, { status: 'failed', errorCode: 'PRESIDIO_ERROR', errorMessageSafe: `Presidio error: ${(e as Error).message}` })
        await appendLog(runId, 'run_failed', 'error', { errorCode: 'PRESIDIO_ERROR' })
      }
      if (config.deleteAfterFailure) {
        await fs.unlink(filePath).catch(() => {})
      }
      return
    }
  }

  const result: AnonymizationResult = {
    source_file_hash: fileNameHash,
    byte_size: byteSize,
    processed_at: nowIso(),
    messages: anonymizedMessages,
    metadata: chatLog.metadata,
  }

  // Mark as anonymized
  if (runId) {
    await updateRun(runId, { status: 'anonymized', presidioStats })
    await appendLog(runId, 'anonymize_succeeded', 'info', { entityCount: Object.values(presidioStats).reduce((a, b) => a + b, 0) })
  }

  // ── Step 4: Call external analysis service (non-fatal) ─────────────────
  if (config.analysisServiceUrl && config.analysisServiceApiKey) {
    const analysisPayload: AnalysisPayload = {
      messages: anonymizedMessages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.timestamp !== undefined && { timestamp: m.timestamp }),
      })),
      conversationId: fileNameHash,
      model: config.analysisServiceModel,
      channel: config.analysisServiceChannel,
      tags: config.analysisServiceTags,
    }

    if (config.analysisServiceSentimentEnabled) {
      try {
        await callAnalysisEndpoint(
          `${config.analysisServiceUrl}/api/v1/analysis/sentiment`,
          { ...analysisPayload, languageCode: config.analysisServiceLanguageCode },
          config.analysisServiceApiKey,
        )
        logger.info('analysis_sentiment_succeeded', { runId: runId ?? undefined, fileHash: fileNameHash })
      } catch (e) {
        logger.warn('analysis_sentiment_failed', { runId: runId ?? undefined, fileHash: fileNameHash, errorMessage: (e as Error).message })
      }
    }

    if (config.analysisServiceToxicityEnabled) {
      try {
        await callAnalysisEndpoint(
          `${config.analysisServiceUrl}/api/v1/analysis/toxicity`,
          analysisPayload,
          config.analysisServiceApiKey,
        )
        logger.info('analysis_toxicity_succeeded', { runId: runId ?? undefined, fileHash: fileNameHash })
      } catch (e) {
        logger.warn('analysis_toxicity_failed', { runId: runId ?? undefined, fileHash: fileNameHash, errorMessage: (e as Error).message })
      }
    }
  }

  // ── Step 5: Deliver ────────────────────────────────────────────────────
  if (runId) {
    await appendLog(runId, 'delivery_started', 'info')
  }
  const deliveryStart = Date.now()
  try {
    const statusCode = await deliverPayload(result)
    const deliveryDurationMs = Date.now() - deliveryStart
    if (runId) {
      await updateRun(runId, {
        status: 'delivered',
        deliveryStatusCode: statusCode ?? undefined,
        deliveryDurationMs,
        durationMs: Date.now() - startMs,
      })
      await appendLog(runId, 'delivery_succeeded', 'info', { statusCode, deliveryDurationMs })
    }
    logger.info('delivery_succeeded', { runId: runId ?? undefined, fileHash: fileNameHash, deliveryDurationMs, statusCode: statusCode ?? undefined })
  } catch (e) {
    logger.error('delivery_failed', { runId: runId ?? undefined, fileHash: fileNameHash, errorMessage: (e as Error).message })
    if (runId) {
      await updateRun(runId, {
        status: 'failed',
        errorCode: 'DELIVERY_ERROR',
        errorMessageSafe: `Delivery error: ${(e as Error).message}`,
        deliveryDurationMs: Date.now() - deliveryStart,
        durationMs: Date.now() - startMs,
      })
      await appendLog(runId, 'run_failed', 'error', { errorCode: 'DELIVERY_ERROR' })
    }
    if (config.deleteAfterFailure) {
      await fs.unlink(filePath).catch(() => {})
    }
    return
  }

  // ── Step 6: Cleanup ────────────────────────────────────────────────────
  if (config.deleteAfterSuccess) {
    try {
      await fs.unlink(filePath)
      if (runId) {
        await updateRun(runId, { status: 'deleted' })
        await appendLog(runId, 'cleanup_deleted', 'info')
      }
      logger.info('cleanup_deleted', { runId: runId ?? undefined, fileHash: fileNameHash })
    } catch (e) {
      logger.warn('cleanup_failed', { runId: runId ?? undefined, fileHash: fileNameHash, errorMessage: (e as Error).message })
    }
  }
}

