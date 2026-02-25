import { FastifyInstance } from 'fastify'
import { WORKER_HEARTBEAT_STALE_MS } from '@local-anonymizer/shared'
import { getDb } from '../db.js'

type ServiceStatus = 'ok' | 'error' | 'unknown'
type WorkerHeartbeatRow = { timestamp: string }

function toHealthUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    if (!url.pathname.endsWith('/health')) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/health`
    }
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    const normalized = baseUrl.replace(/\/+$/, '')
    return normalized.endsWith('/health') ? normalized : `${normalized}/health`
  }
}

async function pingUrl(url: string): Promise<ServiceStatus> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

function getWorkerStatus(): ServiceStatus {
  try {
    const db = getDb()
    const row = db.prepare(`
      SELECT timestamp
      FROM audit_log_events
      WHERE event_type = 'worker_heartbeat'
      ORDER BY timestamp DESC
      LIMIT 1
    `).get() as WorkerHeartbeatRow | undefined

    if (!row) return 'unknown'

    const lastHeartbeatMs = Date.parse(row.timestamp)
    if (!Number.isFinite(lastHeartbeatMs)) return 'error'

    return (Date.now() - lastHeartbeatMs) <= WORKER_HEARTBEAT_STALE_MS ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_req, reply) => {
    const analyzerUrl = process.env.PRESIDIO_ANALYZER_URL ?? null
    const anonymizerUrl = process.env.PRESIDIO_ANONYMIZER_URL ?? null

    const [presidioAnalyzer, presidioAnonymizer] = await Promise.all([
      analyzerUrl ? pingUrl(toHealthUrl(analyzerUrl)) : Promise.resolve<ServiceStatus>('unknown'),
      anonymizerUrl ? pingUrl(toHealthUrl(anonymizerUrl)) : Promise.resolve<ServiceStatus>('unknown'),
    ])
    const worker = getWorkerStatus()

    return reply.send({
      ok: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          api: 'ok' as ServiceStatus,
          worker,
          presidioAnalyzer,
          presidioAnonymizer,
        },
      },
    })
  })
}
