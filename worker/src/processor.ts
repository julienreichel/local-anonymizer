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
} from '@local-anonymizer/shared'

const ANALYZER_URL = process.env.PRESIDIO_ANALYZER_URL ?? 'http://presidio-analyzer:5001'
const ANONYMIZER_URL = process.env.PRESIDIO_ANONYMIZER_URL ?? 'http://presidio-anonymizer:5002'
const TARGET_URL = process.env.TARGET_URL ?? ''
const TARGET_AUTH_HEADER = process.env.TARGET_AUTH_HEADER ?? ''
const API_URL = process.env.API_URL ?? 'http://api:3001'
const LANGUAGE = process.env.LANGUAGE ?? 'en'

// ── API helpers ─────────────────────────────────────────────────────────────

async function createLogEntry(
  fileNameHash: string,
  byteSize: number,
  status: string,
): Promise<string> {
  const res = await fetch(`${API_URL}/api/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name_hash: fileNameHash, byte_size: byteSize, status }),
  })
  const json = (await res.json()) as { success: boolean; data: { id: string } }
  return json.data.id
}

async function updateLogEntry(
  id: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  await fetch(`${API_URL}/api/logs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, error_message: errorMessage }),
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

async function anonymizeText(
  text: string,
  analyzerResults: { entity_type: string; start: number; end: number; score: number }[],
): Promise<string> {
  const res = await fetch(`${ANONYMIZER_URL}/anonymize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, analyzer_results: analyzerResults }),
    signal: AbortSignal.timeout(PRESIDIO_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Anonymizer HTTP ${res.status}`)
  const json = (await res.json()) as { text: string }
  return json.text
}

// ── Delivery helper ─────────────────────────────────────────────────────────

async function deliverPayload(payload: AnonymizationResult): Promise<void> {
  if (!TARGET_URL) {
    console.warn('[worker] TARGET_URL not set – skipping delivery')
    return
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
}

// ── File processing ─────────────────────────────────────────────────────────

export async function processFile(filePath: string): Promise<void> {
  const fileName = path.basename(filePath)
  const ext = path.extname(fileName).toLowerCase()

  if (!ACCEPTED_EXTENSIONS.includes(ext as '.json')) {
    console.log(`[worker] Skipping non-JSON file: ${fileName}`)
    return
  }

  let byteSize = 0
  try {
    const stat = await fs.stat(filePath)
    byteSize = stat.size
  } catch {
    // File may have been removed already
    return
  }

  if (byteSize > MAX_FILE_SIZE_BYTES) {
    console.warn(`[worker] File too large (${byteSize} bytes), skipping: ${fileName}`)
    return
  }

  // Log: only metadata – no raw filename, no content
  const fileNameHash = hashString(fileName)
  console.log(`[worker] Processing file hash=${fileNameHash} size=${byteSize}`)

  let logId: string | null = null
  try {
    logId = await createLogEntry(fileNameHash, byteSize, 'processing')
  } catch (e) {
    console.error('[worker] Could not create log entry:', (e as Error).message)
  }

  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf-8')
  } catch {
    if (logId) await updateLogEntry(logId, 'failed', 'Could not read file')
    return
  }

  // Parse chat log
  let chatLog: ReturnType<typeof ChatLogSchema.parse>
  try {
    chatLog = ChatLogSchema.parse(JSON.parse(raw))
  } catch (e) {
    console.error(`[worker] Invalid chat log schema hash=${fileNameHash}:`, (e as Error).message)
    if (logId) await updateLogEntry(logId, 'failed', 'Invalid schema')
    return
  }

  // Anonymize each message
  const anonymizedMessages: AnonymizedMessage[] = []
  for (const msg of chatLog.messages) {
    try {
      const analysisResults = await analyzeText(msg.content)
      const anonymizedContent = analysisResults.length > 0
        ? await anonymizeText(msg.content, analysisResults)
        : msg.content
      anonymizedMessages.push({
        id: msg.id,
        role: msg.role,
        content: anonymizedContent,
        timestamp: msg.timestamp,
        entities_found: analysisResults.length,
      })
    } catch (e) {
      console.error(`[worker] Presidio error for message ${msg.id}:`, (e as Error).message)
      if (logId) await updateLogEntry(logId, 'failed', `Presidio error: ${(e as Error).message}`)
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
  if (logId) await updateLogEntry(logId, 'anonymized')

  // Deliver
  try {
    await deliverPayload(result)
    if (logId) await updateLogEntry(logId, 'delivered')
    console.log(`[worker] Delivered hash=${fileNameHash}`)
  } catch (e) {
    console.error(`[worker] Delivery failed hash=${fileNameHash}:`, (e as Error).message)
    if (logId) await updateLogEntry(logId, 'failed', `Delivery error: ${(e as Error).message}`)
    return
  }

  // Remove original file after successful delivery
  try {
    await fs.unlink(filePath)
    console.log(`[worker] Removed processed file hash=${fileNameHash}`)
  } catch (e) {
    console.warn(`[worker] Could not remove file hash=${fileNameHash}:`, (e as Error).message)
  }
}
