import { PRESIDIO_TIMEOUT_MS } from '@local-anonymizer/shared'

// ── Types ────────────────────────────────────────────────────────────────────

/** A single entity finding returned by the Presidio Analyzer. */
export interface PresidioFinding {
  entity_type: string
  start: number
  end: number
  score: number
}

/** A single Presidio anonymizer operator configuration. */
export interface PresidioOperator {
  type: 'replace' | 'redact' | 'hash'
  hash_type?: string
}

/**
 * Map of entity type → operator.
 * Use the key `"DEFAULT"` to apply an operator to all entity types.
 */
export type PresidioOperatorsMap = Record<string, PresidioOperator>

// ── Client ───────────────────────────────────────────────────────────────────

export class PresidioClient {
  constructor(
    private readonly analyzerUrl: string,
    private readonly anonymizerUrl: string,
  ) {}

  /**
   * Send text to the Presidio Analyzer and return detected entity findings.
   *
   * @param text            - The plain-text content to analyse.
   * @param language        - BCP-47 language code, e.g. `"en"`.
   * @param entities        - Optional list of entity types to detect (default: all).
   * @param scoreThreshold  - Minimum confidence score (0–1) to include a finding.
   */
  async analyze(
    text: string,
    language: string,
    entities?: string[],
    scoreThreshold?: number,
  ): Promise<PresidioFinding[]> {
    const body: Record<string, unknown> = { text, language }
    if (entities && entities.length > 0) body.entities = entities
    if (scoreThreshold !== undefined) body.score_threshold = scoreThreshold

    const res = await fetch(`${this.analyzerUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PRESIDIO_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Presidio Analyzer HTTP ${res.status}`)
    return res.json() as Promise<PresidioFinding[]>
  }

  /**
   * Send text and analyzer findings to the Presidio Anonymizer.
   *
   * @param text      - The original plain-text content.
   * @param findings  - Array of findings previously returned by `analyze()`.
   * @param operators - Map of entity type → operator, keyed by entity type or `"DEFAULT"`.
   * @returns The anonymized text.
   */
  async anonymize(
    text: string,
    findings: PresidioFinding[],
    operators: PresidioOperatorsMap,
  ): Promise<string> {
    const res = await fetch(`${this.anonymizerUrl}/anonymize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, analyzer_results: findings, anonymizers: operators }),
      signal: AbortSignal.timeout(PRESIDIO_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Presidio Anonymizer HTTP ${res.status}`)
    const json = (await res.json()) as { text: string }
    return json.text
  }
}
