# SECURITY.md

## No-PII Logging Policy

Local Anonymizer is designed from the ground up to ensure that **no personally identifiable information (PII) ever enters logs, the database, or any persistence layer** other than the anonymized delivery payload sent to the configured `TARGET_URL`.

### What is stored

| Storage location | Fields stored | PII present? |
|---|---|---|
| `processing_runs` table | `id`, `sourceFileName` (SHA-256 hash of filename), `sourceFileSize`, `status`, `errorCode`, `errorMessageSafe`, `presidioStats`, timestamps | ❌ No |
| `audit_log_events` table | `id`, `runId`, `eventType`, `level`, `meta` (numeric/boolean counters only), `timestamp` | ❌ No |
| Worker structured logs | `eventType`, `fileHash`, `byteSize`, `durationMs`, `statusCode`, `runId` | ❌ No |
| API server logs (Fastify) | HTTP method, URL path, status code, response time | ❌ No |
| Delivery payload (`TARGET_URL`) | Anonymized messages (PII replaced/redacted), `source_file_hash`, `byte_size`, `processed_at` | ❌ No (anonymized) |

### What is never stored

- Raw message content (before or after anonymization)
- Original filenames or file paths
- Any extracted entity text (names, emails, phone numbers, etc.)
- Presidio analysis intermediate results

### Source file handling

The worker stores only a **SHA-256 hash of the original filename**, not the filename itself. The actual file content is:

1. Read into memory.
2. Passed to Presidio for analysis and anonymization.
3. Discarded immediately after delivery.
4. Optionally deleted from the uploads folder (`deleteAfterSuccess: true`).

### Error messages

Error messages stored in `errorMessageSafe` are **always hardcoded safe strings** set by the worker (e.g., `"Invalid schema"`, `"Delivery error"`). They never include raw file content, user input, or Presidio response bodies.

### Structured log fields

Worker logs are structured JSON and include only:

```json
{
  "level": "info|warn|error",
  "time": 1700000000000,
  "service": "worker",
  "eventType": "file_detected|anonymize_succeeded|...",
  "runId": "<uuid>",
  "fileHash": "<sha256>",
  "byteSize": 1234,
  "durationMs": 42
}
```

Content fields (`content`, `text`, `message`) are **never** logged.

---

## Threat Model (Local Environment)

This tool is designed exclusively for **local use** on a developer's machine. It is not designed or hardened for production / multi-tenant deployment.

### In-scope threats

| Threat | Mitigation |
|---|---|
| PII leaking into application logs | Structured logger emits only safe metadata; tested by automated PII guard tests |
| PII leaking into the database | Only hashed filenames and safe counters are stored; enforced by schema + tests |
| PII delivered to an unintended endpoint | `TARGET_URL` is explicitly configured; no default delivery target; rate limiting on the API |
| Oversized / malformed files crashing the pipeline | Max file size check (`maxFileSizeBytes`); Zod schema validation before Presidio calls |
| Presidio service unavailable | Worker marks run as `failed` with a safe error code; does not crash |
| Replay / double-processing of files | In-flight set in the worker prevents concurrent processing of the same file |

### Out-of-scope threats

- Network-level TLS verification of the delivery endpoint (responsibility of the operator)
- Authentication to the local API (the API runs on localhost; no multi-user isolation)
- Container escape or host OS compromise
- Secrets in environment variables (`.env` file is gitignored; never commit secrets)

### Target URL security

The `TARGET_URL` receives the anonymized payload. You are responsible for:

1. **TLS**: Use HTTPS endpoints in production.
2. **Authentication**: Set `TARGET_AUTH_HEADER=Bearer <token>` in `.env` for token-based auth.
3. **Network isolation**: Ensure `TARGET_URL` is accessible only from trusted networks.

---

## Reporting Security Issues

If you discover a security vulnerability in this project, please open a GitHub issue with the label `security`. Since this is a local-only tool, there is no responsible-disclosure embargo period, but please describe the issue clearly and include reproduction steps.
