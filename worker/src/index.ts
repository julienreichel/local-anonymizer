import chokidar from 'chokidar'
import path from 'node:path'
import { POLL_INTERVAL_MS } from '@local-anonymizer/shared'
import { processFile } from './processor.js'

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? '/uploads'

console.log(`[worker] Starting file watcher on: ${UPLOADS_DIR}`)

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

watcher.on('add', async (filePath: string) => {
  if (inFlight.has(filePath)) return
  inFlight.add(filePath)
  try {
    await processFile(filePath)
  } catch (err) {
    console.error(`[worker] Unhandled error processing ${path.basename(filePath)}:`, err)
  } finally {
    inFlight.delete(filePath)
  }
})

watcher.on('error', (err: unknown) => {
  console.error('[worker] Watcher error:', err)
})

watcher.on('ready', () => {
  console.log('[worker] Initial scan complete. Watching for new files...')
})

// Graceful shutdown
function shutdown() {
  console.log('[worker] Shutting down...')
  watcher.close().then(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
