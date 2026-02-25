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
 * Rewrites loopback hosts for requests originating from containers.
 * In Docker, localhost/127.0.0.1/::1 points to the container itself.
 */
export function normalizeLocalTargetUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
      parsed.hostname = 'host.docker.internal'
    }
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Pauses execution for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
