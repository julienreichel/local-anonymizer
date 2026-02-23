import { buildApp } from './app.js'
import { API_PORT } from '@local-anonymizer/shared'

const port = Number(process.env.PORT ?? API_PORT)
const host = process.env.HOST ?? '0.0.0.0'

const app = await buildApp()

try {
  await app.listen({ port, host })
  console.log(`API server listening on http://${host}:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
