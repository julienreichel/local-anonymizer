import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { healthRoutes } from './routes/health.js'
import { logRoutes } from './routes/logs.js'
import { configRoutes } from './routes/config.js'
import { targetRoutes } from './routes/targets.js'
import { runRoutes } from './routes/runs.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })

  // Rate-limit all routes: 200 requests per minute per IP.
  // This is a local app but rate limiting prevents runaway loops from bugs.
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  })

  await app.register(healthRoutes)
  await app.register(configRoutes)
  await app.register(targetRoutes)
  await app.register(runRoutes)
  await app.register(logRoutes)

  return app
}
