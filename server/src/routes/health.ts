import { FastifyInstance } from 'fastify'

type ServiceStatus = 'ok' | 'error' | 'unknown'

async function pingUrl(url: string): Promise<ServiceStatus> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (_req, reply) => {
    const analyzerUrl = process.env.PRESIDIO_ANALYZER_URL ?? null
    const anonymizerUrl = process.env.PRESIDIO_ANONYMIZER_URL ?? null

    const [presidioAnalyzer, presidioAnonymizer] = await Promise.all([
      analyzerUrl ? pingUrl(analyzerUrl) : Promise.resolve<ServiceStatus>('unknown'),
      anonymizerUrl ? pingUrl(anonymizerUrl) : Promise.resolve<ServiceStatus>('unknown'),
    ])

    return reply.send({
      ok: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          api: 'ok' as ServiceStatus,
          presidioAnalyzer,
          presidioAnonymizer,
        },
      },
    })
  })
}
