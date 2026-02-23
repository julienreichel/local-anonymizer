import { describe, it, expect } from 'vitest'
import {
  ProcessingRunSchema,
  ProcessingRunStatusSchema,
  AppConfigSchema,
  DeliveryTargetSchema,
  AuditLogEventSchema,
  HealthSchema,
} from './useApi'

// ---------------------------------------------------------------------------
// ProcessingRunStatusSchema
// ---------------------------------------------------------------------------

describe('ProcessingRunStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const statuses = ['queued', 'processing', 'anonymized', 'delivered', 'failed', 'deleted']
    for (const status of statuses) {
      expect(ProcessingRunStatusSchema.parse(status)).toBe(status)
    }
  })

  it('rejects unknown status', () => {
    expect(() => ProcessingRunStatusSchema.parse('unknown')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// ProcessingRunSchema
// ---------------------------------------------------------------------------

describe('ProcessingRunSchema', () => {
  const base = {
    id: '00000000-0000-0000-0000-000000000001',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceType: 'folderUpload' as const,
    sourceFileName: 'sha256:abc123',
    sourceFileSize: 1024,
    status: 'delivered' as const,
  }

  it('parses a minimal valid run', () => {
    const result = ProcessingRunSchema.parse(base)
    expect(result.id).toBe(base.id)
    expect(result.status).toBe('delivered')
  })

  it('accepts optional fields', () => {
    const result = ProcessingRunSchema.parse({
      ...base,
      presidioStats: { PERSON: 3 },
      deliveryStatusCode: 200,
      durationMs: 500,
    })
    expect(result.presidioStats?.PERSON).toBe(3)
    expect(result.deliveryStatusCode).toBe(200)
  })

  it('rejects missing required fields', () => {
    expect(() => ProcessingRunSchema.parse({ id: '123' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// AppConfigSchema
// ---------------------------------------------------------------------------

describe('AppConfigSchema', () => {
  it('applies defaults for empty input', () => {
    const result = AppConfigSchema.parse({})
    expect(result.watchFolderPath).toBe('/uploads')
    expect(result.deleteAfterSuccess).toBe(false)
    expect(result.deleteAfterFailure).toBe(false)
    expect(result.maxFileSizeBytes).toBe(10 * 1024 * 1024)
    expect(result.acceptedExtensions).toEqual(['.json'])
    expect(result.pollIntervalMs).toBe(5000)
    expect(result.anonymizationOperator).toBe('replace')
  })

  it('accepts valid config overrides', () => {
    const result = AppConfigSchema.parse({
      deleteAfterSuccess: true,
      pollIntervalMs: 3000,
      anonymizationOperator: 'hash',
    })
    expect(result.deleteAfterSuccess).toBe(true)
    expect(result.pollIntervalMs).toBe(3000)
    expect(result.anonymizationOperator).toBe('hash')
  })

  it('rejects invalid anonymizationOperator', () => {
    expect(() => AppConfigSchema.parse({ anonymizationOperator: 'invalid' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// DeliveryTargetSchema
// ---------------------------------------------------------------------------

describe('DeliveryTargetSchema', () => {
  const base = {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Test Target',
    url: 'https://example.com/hook',
    method: 'POST' as const,
    headers: {},
    auth: { type: 'none' as const },
    timeoutMs: 15000,
    retries: 0,
    backoffMs: 1000,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('parses a valid target with no auth', () => {
    const result = DeliveryTargetSchema.parse(base)
    expect(result.name).toBe('Test Target')
    expect(result.auth.type).toBe('none')
  })

  it('parses bearer token auth', () => {
    const result = DeliveryTargetSchema.parse({
      ...base,
      auth: { type: 'bearerToken', token: 'my-token' },
    })
    expect(result.auth.type).toBe('bearerToken')
    if (result.auth.type === 'bearerToken') {
      expect(result.auth.token).toBe('my-token')
    }
  })

  it('parses API key header auth', () => {
    const result = DeliveryTargetSchema.parse({
      ...base,
      auth: { type: 'apiKeyHeader', header: 'X-Api-Key', key: 'secret' },
    })
    expect(result.auth.type).toBe('apiKeyHeader')
  })

  it('parses basic auth', () => {
    const result = DeliveryTargetSchema.parse({
      ...base,
      auth: { type: 'basic', username: 'admin', password: 'pass' },
    })
    expect(result.auth.type).toBe('basic')
  })

  it('rejects unknown auth type', () => {
    expect(() =>
      DeliveryTargetSchema.parse({ ...base, auth: { type: 'magic' } }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// AuditLogEventSchema
// ---------------------------------------------------------------------------

describe('AuditLogEventSchema', () => {
  const base = {
    id: '00000000-0000-0000-0000-000000000003',
    timestamp: new Date().toISOString(),
    level: 'info' as const,
    eventType: 'file_detected' as const,
  }

  it('parses a minimal audit event', () => {
    const result = AuditLogEventSchema.parse(base)
    expect(result.eventType).toBe('file_detected')
    expect(result.level).toBe('info')
  })

  it('accepts all event types', () => {
    const types = [
      'file_detected',
      'anonymize_started',
      'anonymize_succeeded',
      'delivery_started',
      'delivery_succeeded',
      'cleanup_deleted',
      'run_failed',
    ]
    for (const eventType of types) {
      expect(() => AuditLogEventSchema.parse({ ...base, eventType })).not.toThrow()
    }
  })

  it('rejects invalid level', () => {
    expect(() => AuditLogEventSchema.parse({ ...base, level: 'debug' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// HealthSchema
// ---------------------------------------------------------------------------

describe('HealthSchema', () => {
  it('parses basic health response', () => {
    const result = HealthSchema.parse({ status: 'ok', timestamp: new Date().toISOString() })
    expect(result.status).toBe('ok')
    expect(result.services).toBeUndefined()
  })

  it('parses health response with services', () => {
    const result = HealthSchema.parse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        api: 'ok',
        presidioAnalyzer: 'ok',
        presidioAnonymizer: 'unknown',
      },
    })
    expect(result.services?.api).toBe('ok')
    expect(result.services?.presidioAnonymizer).toBe('unknown')
  })

  it('rejects invalid service status', () => {
    expect(() =>
      HealthSchema.parse({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: { api: 'ok', presidioAnalyzer: 'running', presidioAnonymizer: 'ok' },
      }),
    ).toThrow()
  })
})
