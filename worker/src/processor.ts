import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ChatLogSchema,
  ACCEPTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  PRESIDIO_TIMEOUT_MS,
  DELIVERY_TIMEOUT_MS,
  hashString,
  nowIso,
  type AnonymizationResult,
  type AnonymizedMessage,
  type AnonymizationOperator,
} from '@local-anonymizer/shared'

const ANALYZER_URL = process.env.PRESIDIO_ANALYZER_URL ?? 'http://presidio-analyzer:5001'
const ANONYMIZER_URL = process.env.PRESIDIO_ANONYMIZER_URL ?? 'http://presidio-anonymizer:5002'
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
    }
  } catch {
    // Fall back to safe defaults if the API is unavailable
    return {
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      deleteAfterSuccess: false,
      deleteAfterFailure: false,
      anonymizationOperator: 'replace',
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

async function analyzeText(text: string): Promise<{ entity_type: string; start: number; end: number; score: number }[]> {
  const res = await fetch(`${ANALYZER_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language: LANGUAGE }),
    signal: AbortSignal.timeout(PRESIDIO_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Analyzer HTTP ${res.status}`)
  return res.json() as Promise<{ entity_type: string; start: number; end: number; score: number }[]>
}

/** Build the Presidio anonymizers map based on the configured operator. */
function buildAnonymizers(operator: AnonymizationOperator): Record<string, unknown> {
  switch (operator) {
    case 'redact':
      return { DEFAULT: { type: 'redact' } }
    case 'hash':
      return { DEFAULT: { type: 'hash', hash_type: 'sha256' } }
    default: // 'replace' – replace each entity with its <ENTITY_TYPE> label
      return { DEFAULT: { type: 'replace' } }
  }
}

async function anonymizeText(
  text: string,
  analyzerResults: { entity_type: string; start: number; end: number; score: number }[],
  operator: AnonymizationOperator,
): Promise<string> {
  const anonymizers = buildAnonymizers(operator)
  const res = await fetch(`${ANONYMIZER_URL}/anonymize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, analyzer_results: analyzerResults, anonymizers }),
    signal: AbortSignal.timeout(PRESIDIO_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Anonymizer HTTP ${res.status}`)
  const json = (await res.json()) as { text: string }
  return json.text
}

// ── Delivery helper ─────────────────────────────────────────────────────────

async function deliverPayload(payload: AnonymizationResult): Promise<number | null> {
  if (!TARGET_URL) {
    console.warn('[worker] TARGET_URL not set – skipping delivery')
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

// ── File processing ─────────────────────────────────────────────────────────

export async function processFile(filePath: string): Promise<void> {
  const fileName = path.basename(filePath)
  const ext = path.extname(fileName).toLowerCase()

  if (!ACCEPTED_EXTENSIONS.includes(ext as '.json')) {
    console.log(`[worker] Skipping non-JSON file: ${fileName}`)
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
    console.warn(`[worker] File too large (${byteSize} bytes), skipping: ${fileName}`)
    return
  }

  // Store only a sanitized reference: hash of filename – no raw path or content
  const fileNameHash = hashString(fileName)
  const sourceFileName = `sha256:${fileNameHash}`
  console.log(`[worker] Processing file hash=${fileNameHash} size=${byteSize}`)

  const startMs = Date.now()
  let runId: string | null = null

  // ── Step 1: Create run record as "queued" ──────────────────────────────
  try {
    runId = await createRun(sourceFileName, byteSize, 'queued')
    await appendLog(runId, 'file_detected', 'info', { byteSize })
  } catch (e) {
    console.error('[worker] Could not create run entry:', (e as Error).message)
  }

  // ── Step 2: Begin processing ───────────────────────────────────────────
  if (runId) {
    try {
      await updateRun(runId, { status: 'processing' })
      await appendLog(runId, 'anonymize_started', 'info')
    } catch (e) {
      console.error('[worker] Could not update run to processing:', (e as Error).message)
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
    console.error(`[worker] Invalid chat log schema hash=${fileNameHash}:`, (e as Error).message)
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
      const analysisResults = await analyzeText(msg.content)
      const anonymizedContent = analysisResults.length > 0
        ? await anonymizeText(msg.content, analysisResults, config.anonymizationOperator)
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
      console.error(`[worker] Presidio error for message ${msg.id}:`, (e as Error).message)
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

  // ── Step 4: Deliver ────────────────────────────────────────────────────
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
    console.log(`[worker] Delivered hash=${fileNameHash}`)
  } catch (e) {
    console.error(`[worker] Delivery failed hash=${fileNameHash}:`, (e as Error).message)
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

  // ── Step 5: Cleanup ────────────────────────────────────────────────────
  if (config.deleteAfterSuccess) {
    try {
      await fs.unlink(filePath)
      if (runId) {
        await updateRun(runId, { status: 'deleted' })
        await appendLog(runId, 'cleanup_deleted', 'info')
      }
      console.log(`[worker] Removed processed file hash=${fileNameHash}`)
    } catch (e) {
      console.warn(`[worker] Could not remove file hash=${fileNameHash}:`, (e as Error).message)
    }
  }
}

