import chokidar from 'chokidar'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { POLL_INTERVAL_MS, WORKER_HEARTBEAT_INTERVAL_MS } from '@local-anonymizer/shared'
import { processFile } from './processor.js'
import { logger } from './logger.js'

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? '/uploads'
const API_URL = process.env.API_URL ?? 'http://api:3001'

logger.info('watcher_starting', { uploadsDir: UPLOADS_DIR })

async function sendWorkerHeartbeat(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'worker_heartbeat',
        level: 'info',
        meta: { uploadsDir: UPLOADS_DIR },
      }),
    })
  } catch (err) {
    logger.warn('worker_heartbeat_failed', { errorMessage: (err as Error).message })
  }
}

// Use polling as the primary cross-platform strategy.
// chokidar falls back to native FS events where available (macOS FSEvents,
// Linux inotify) and polls on Windows / network shares – OS-agnostic.
const watcher = chokidar.watch(path.resolve(UPLOADS_DIR), {
  persistent: true,
  ignoreInitial: false,
  // Polling ensures we work correctly on Windows (NTFS), Docker bind mounts,
  // and networked filesystems where native events may be unavailable.
  usePolling: true,
  interval: POLL_INTERVAL_MS,
  awaitWriteFinish: {
    // Wait until a file stops growing before processing it
    stabilityThreshold: 2000,
    pollInterval: 500,
  },
  // Only watch JSON files
  ignored: /[/\\]\./,
})

// Track files being processed to avoid double-processing
const inFlight = new Set<string>()
const fileState = new Map<string, string>()

async function handleFileEvent(filePath: string): Promise<void> {
  if (inFlight.has(filePath)) return
  inFlight.add(filePath)
  try {
    await processFile(filePath)
  } catch (err) {
    logger.error('unhandled_error', { errorMessage: (err as Error).message })
  } finally {
    inFlight.delete(filePath)
  }
}

watcher.on('add', (filePath: string) => {
  void handleFileEvent(filePath)
})

watcher.on('change', (filePath: string) => {
  void handleFileEvent(filePath)
})

watcher.on('error', (err: unknown) => {
  logger.error('watcher_error', { errorMessage: (err as Error).message })
})

watcher.on('ready', () => {
  logger.info('watcher_ready', { uploadsDir: UPLOADS_DIR })
  void sendWorkerHeartbeat()
  void scanUploadsDir()
})

const heartbeatTimer = setInterval(() => {
  void sendWorkerHeartbeat()
}, WORKER_HEARTBEAT_INTERVAL_MS)
heartbeatTimer.unref()

async function listJsonFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...await listJsonFiles(fullPath))
      continue
    }
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') {
      out.push(fullPath)
    }
  }
  return out
}

/**
 * Fallback scanner for Docker bind mounts where chokidar events can be unreliable.
 * We track mtime+size and process only new/changed files once they are stable.
 */
async function scanUploadsDir(): Promise<void> {
  const files = await listJsonFiles(path.resolve(UPLOADS_DIR))
  const now = Date.now()
  for (const filePath of files) {
    let stat: { size: number; mtimeMs: number }
    try {
      stat = await fs.stat(filePath)
    } catch {
      continue
    }
    // Similar to awaitWriteFinish: skip files modified in the last 2 seconds.
    if ((now - stat.mtimeMs) < 2000) continue
    const stamp = `${stat.size}:${Math.floor(stat.mtimeMs)}`
    if (fileState.get(filePath) === stamp) continue
    fileState.set(filePath, stamp)
    void handleFileEvent(filePath)
  }
}

const pollTimer = setInterval(() => {
  void scanUploadsDir()
}, POLL_INTERVAL_MS)
pollTimer.unref()

// Graceful shutdown
function shutdown() {
  logger.info('shutdown_initiated')
  clearInterval(heartbeatTimer)
  clearInterval(pollTimer)
  watcher.close().then(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
