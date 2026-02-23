import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { healthRoutes } from './routes/health.js'
import { logRoutes } from './routes/logs.js'
import { configRoutes } from './routes/config.js'
import { API_PORT } from '@local-anonymizer/shared'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? '*',
})

// Rate-limit all routes: 200 requests per minute per IP.
// This is a local app but rate limiting prevents runaway loops from bugs.
await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
})

await app.register(healthRoutes)
await app.register(logRoutes)
await app.register(configRoutes)

const port = Number(process.env.PORT ?? API_PORT)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
  console.log(`API server listening on http://${host}:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
