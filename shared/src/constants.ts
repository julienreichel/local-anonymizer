// ---------------------------------------------------------------------------
// Application-wide constants
// ---------------------------------------------------------------------------

/** Default port the API server listens on inside the container */
export const API_PORT = 3001

/** Default port the Nuxt UI listens on inside the container */
export const UI_PORT = 3000

/** Presidio service default ports */
export const PRESIDIO_ANALYZER_PORT = 5001
export const PRESIDIO_ANONYMIZER_PORT = 5002

/** File extensions accepted by the worker */
export const ACCEPTED_EXTENSIONS = ['.json'] as const

/** Worker polling interval fallback (ms) – used when FS events are unavailable */
export const POLL_INTERVAL_MS = 5_000

/** Worker heartbeat interval (ms) – controls worker liveness updates to API */
export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000

/** Maximum heartbeat age (ms) before worker is considered unhealthy */
export const WORKER_HEARTBEAT_STALE_MS = 45_000

/** Maximum file size the worker will process (10 MB) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

/** SQLite database filename (relative to the data volume) */
export const DB_FILENAME = 'local-anonymizer.db'

/** HTTP timeout for Presidio calls (ms) */
export const PRESIDIO_TIMEOUT_MS = 30_000

/** HTTP timeout for delivery calls (ms) */
export const DELIVERY_TIMEOUT_MS = 15_000
