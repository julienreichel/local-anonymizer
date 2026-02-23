/**
 * Structured logger for the worker process.
 *
 * Emits JSON lines to stdout/stderr that match the Fastify log format used by
 * the API service.  Fields are safe: no message content, no raw PII is ever
 * included.  Available fields: level, time, runId, eventType, durationMs,
 * status, and any additional safe metadata passed by the caller.
 */

type LogLevel = 'info' | 'warn' | 'error'

type SafeMeta = Record<string, string | number | boolean | undefined | null>

function log(level: LogLevel, eventType: string, meta?: SafeMeta): void {
  const entry: Record<string, unknown> = {
    level,
    time: Date.now(),
    service: 'worker',
    eventType,
    ...meta,
  }
  const line = JSON.stringify(entry)
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

export const logger = {
  info: (eventType: string, meta?: SafeMeta) => log('info', eventType, meta),
  warn: (eventType: string, meta?: SafeMeta) => log('warn', eventType, meta),
  error: (eventType: string, meta?: SafeMeta) => log('error', eventType, meta),
}
