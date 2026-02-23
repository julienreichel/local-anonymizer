import crypto from 'node:crypto'

/**
 * Returns a SHA-256 hex digest of the given string.
 * Used to hash file names before storing them in logs (no raw PII in DB).
 */
export function hashString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/**
 * Returns the current UTC timestamp as an ISO-8601 string.
 */
export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Pauses execution for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
