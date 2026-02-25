# local-anonymizer

A **local, OS-agnostic** application that watches a folder for uploaded chat-log files (JSON), anonymizes PII using **Microsoft Presidio**, delivers the sanitized payloads to a configurable HTTP endpoint, and provides a web UI for configuration and monitoring.

Everything runs in Docker containers – no Python, Rust, or native dependencies required on the host.

---

## Quick-start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / macOS) or Docker Engine + Compose plugin (Linux)
- No other tools required on the host

### 1. Clone and configure

```bash
git clone https://github.com/julienreichel/local-anonymizer.git
cd local-anonymizer

# Copy the example environment file
cp .env.example .env
```

Open `.env` and set, at minimum:

```dotenv
# Absolute or relative path to the watched folder
UPLOADS_DIR=./infra/volumes/uploads

# (Optional) Legacy single-target delivery – still supported as a fallback
# when no Delivery Targets are configured in the dashboard.
TARGET_URL=https://your-ingest-endpoint.example.com/ingest
TARGET_AUTH_HEADER=Bearer eyJhb...
```

> **Recommended**: use the **Delivery Targets** feature in the dashboard instead of `TARGET_URL` — it gives you full control over the HTTP method, headers, auth, and payload format for each destination.

### 2. Start all services

```bash
docker compose up --build
```

> **First run** downloads the Presidio images (~1 GB) and builds the three custom images. Subsequent runs are much faster.

### 3. Open the dashboard

```
http://localhost:3000
```

From the dashboard you can:

- Monitor total / delivered / failed / pending runs
- Browse audit logs (file hash, size, status – **no PII stored**)
- Configure **Delivery Targets** (URL, method, auth, payload template) and anonymization settings

### 4. Drop a test file

Copy the provided fixture into the uploads folder and watch it get processed:

```bash
cp fixtures/chat-valid.json infra/volumes/uploads/
```

The worker picks it up within 5 seconds, anonymizes every message, delivers the result to all enabled Delivery Targets, and records the result in the dashboard.

---

## Delivery Targets

Delivery Targets are the primary way to send anonymized payloads to external services. Each target is fully configurable: URL, HTTP method, request headers, authentication, and an optional payload template. Multiple targets can be active at the same time — the worker calls all enabled targets in sequence after each file is processed.

Configure targets from the dashboard or via the REST API (`POST /api/targets`).

### Auth types

| Type | Config |
|---|---|
| None | `{ "type": "none" }` |
| Bearer token | `{ "type": "bearerToken", "token": "<token>" }` |
| API key header | `{ "type": "apiKeyHeader", "header": "X-API-Key", "key": "<key>" }` |
| HTTP Basic | `{ "type": "basic", "username": "user", "password": "pass" }` |

### Body template

By default the full anonymized result is sent. Set `bodyTemplate` on a target to control exactly what is sent:

```json
{
  "messages": "${messages}",
  "conversationId": "${source_file_hash}",
  "languageCode": "en"
}
```

Available template variables:

| Variable | Value |
|---|---|
| `${messages}` | Anonymized messages as `[{ role, content, timestamp? }]` |
| `${source_file_hash}` | SHA-256 hash of the source filename |
| `${processed_at}` | ISO-8601 processing timestamp |
| `${byte_size}` | File size in bytes |
| `${metadata}` | Optional metadata object from the chat log |

### Example: two endpoints on the same analysis service

```json
[
  {
    "name": "Sentiment Analysis",
    "url": "https://analysis.example.com/api/v1/analysis/sentiment",
    "method": "POST",
    "auth": { "type": "apiKeyHeader", "header": "X-API-Key", "key": "your-key" },
    "bodyTemplate": {
      "messages": "${messages}",
      "conversationId": "${source_file_hash}",
      "languageCode": "en",
      "model": "gpt-4",
      "channel": "web-chat",
      "tags": ["support"]
    }
  },
  {
    "name": "Toxicity Analysis",
    "url": "https://analysis.example.com/api/v1/analysis/toxicity",
    "method": "POST",
    "auth": { "type": "apiKeyHeader", "header": "X-API-Key", "key": "your-key" },
    "bodyTemplate": {
      "messages": "${messages}",
      "conversationId": "${source_file_hash}"
    }
  }
]
```

### Legacy `TARGET_URL` fallback

The `TARGET_URL` and `TARGET_AUTH_HEADER` environment variables are still supported. They are used **only** when no Delivery Targets are configured in the database. New deployments should use the Delivery Target system instead.

---

## Configuration flow

All runtime settings are managed through the REST API and persisted in SQLite. The worker fetches config at startup and before each file is processed.

### Environment variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `UPLOADS_DIR` | `./infra/volumes/uploads` | Host path bind-mounted into the worker |
| `TARGET_URL` | _(empty)_ | **Legacy fallback** delivery endpoint — used only when no Delivery Targets are configured in the DB; if empty, delivery is skipped |
| `TARGET_AUTH_HEADER` | _(empty)_ | **Legacy fallback** full `Authorization` header value (e.g. `Bearer <token>`) |
| `LANGUAGE` | `en` | BCP-47 language code passed to Presidio |
| `DATA_DIR` | `./infra/volumes/data` | Host path for SQLite database persistence |
| `API_PORT` | `3001` | Exposed port for the REST API |
| `UI_PORT` | `3000` | Exposed port for the web UI |

### API-configurable settings (`PUT /api/config`)

| Field | Default | Description |
|---|---|---|
| `watchFolderPath` | `/uploads` | Path inside the worker container |
| `deleteAfterSuccess` | `false` | Delete the source file after successful delivery |
| `deleteAfterFailure` | `false` | Delete the source file when processing fails |
| `maxFileSizeBytes` | `10485760` (10 MB) | Reject files larger than this |
| `acceptedExtensions` | `[".json"]` | File extensions processed by the worker |
| `pollIntervalMs` | `5000` | chokidar polling interval (ms) |
| `anonymizationOperator` | `"replace"` | PII replacement strategy: `replace`, `redact`, or `hash` |

---

## Supported chat log format

The worker accepts JSON files matching this schema:

```json
{
  "version": "1.0",
  "messages": [
    {
      "id": "string (required)",
      "role": "user | assistant | system (required)",
      "content": "string (required)",
      "timestamp": "ISO-8601 datetime (optional)"
    }
  ],
  "metadata": { "any": "key-value pairs (optional)" }
}
```

See `fixtures/chat-valid.json` for a working example with PII and `fixtures/chat-invalid.json` for a schema-invalid example used in automated tests.

### Anonymization operators

| Operator | Example input | Example output |
|---|---|---|
| `replace` (default) | `john@example.com` | `<EMAIL_ADDRESS>` |
| `redact` | `john@example.com` | _(empty string)_ |
| `hash` | `john@example.com` | `8d969eef...` (SHA-256) |

---

## How to add new sources or triggers

The current worker polls a folder (`chokidar`). To add a new trigger:

1. **Create a trigger module** in `worker/src/` (e.g. `webhook-trigger.ts`) that calls `processFile(filePath)` after writing the received payload to a temp file.
2. **Register the trigger** in `worker/src/index.ts` alongside the existing watcher.
3. **Add a new `sourceType`** value to `ProcessingRunSchema` in `shared/src/schemas.ts` if the new source needs a distinct label in the dashboard.

No changes to the API or worker pipeline are required – `processFile` is the single entry point for all sources.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Host                                                           │
│  uploads/ ──────────────────────────────────────────────┐      │
│                                                          ▼      │
│  ┌───────────┐    HTTP    ┌───────────┐   ┌──────────────────┐ │
│  │  Browser  │◄──────────│  ui       │   │  worker          │ │
│  └───────────┘           │ (Nuxt 3)  │   │ (chokidar watcher│ │
│                          │ :3000     │   │  + Presidio pipe) │ │
│                          └───────────┘   └──────────────────┘ │
│                                │ /api          │               │
│                                ▼              ▼               │
│                          ┌───────────┐  ┌──────────────────┐  │
│                          │  api      │  │ presidio-analyzer │  │
│                          │ (Fastify  │  │ :5001             │  │
│                          │  SQLite)  │  ├──────────────────┤  │
│                          │ :3001     │  │ presidio-anonymizer│ │
│                          └───────────┘  │ :5002             │  │
│                               │         └──────────────────┘  │
│                          data/ (SQLite)                        │
└─────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Image / Source | Port | Description |
|---|---|---|---|
| `ui` | `app/` (Nuxt 3 + Nuxt UI) | 3000 | Web dashboard – monitoring & config |
| `api` | `server/` (Fastify + SQLite) | 3001 | REST API – logs, config, control plane |
| `worker` | `worker/` (chokidar) | – | Watches uploads/, drives Presidio pipeline |
| `presidio-analyzer` | `mcr.microsoft.com/presidio-analyzer` | 5001 | PII entity detection |
| `presidio-anonymizer` | `mcr.microsoft.com/presidio-anonymizer` | 5002 | PII replacement/redaction |

---

## Repository structure

```
local-anonymizer/
├── app/                   # Nuxt 3 + Nuxt UI frontend
│   ├── composables/
│   │   └── useApi.ts      # Typed API client + Zod schemas
│   ├── pages/
│   └── Dockerfile
├── server/                # Fastify API + SQLite
│   ├── src/
│   │   ├── db.ts          # SQLite schema + migration
│   │   └── routes/        # config, targets, runs, logs, health
│   └── Dockerfile
├── worker/                # File watcher + processing pipeline
│   ├── src/
│   │   ├── index.ts       # chokidar watcher (cross-platform)
│   │   ├── logger.ts      # Structured JSON logger (no PII)
│   │   └── processor.ts   # Presidio pipeline + delivery
│   └── Dockerfile
├── shared/                # Zod schemas, types, constants, utilities
│   └── src/
├── fixtures/
│   ├── chat-valid.json    # Valid chat log with PII for testing
│   └── chat-invalid.json  # Invalid chat log (wrong schema) for testing
├── infra/
│   ├── volumes/
│   │   ├── uploads/       # Bind-mounted into worker container
│   │   └── data/          # SQLite database persistence
│   └── scripts/
│       └── reset-volumes.sh
├── docker-compose.yml
├── .env.example
├── SECURITY.md            # No-PII logging policy + threat model
└── pnpm-workspace.yaml
```

---

## Development

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm`)

### Install dependencies

```bash
pnpm install
```

### Root scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start all packages in watch/dev mode (parallel) |
| `pnpm build` | Build all packages |
| `pnpm lint` | Type-check all packages |
| `pnpm test` | Run all tests |
| `pnpm docker:up` | `docker compose up --build` |
| `pnpm docker:down` | `docker compose down` |

### Running tests

```bash
# All tests (shared echo, server vitest, worker vitest, app vitest)
pnpm test

# Individual packages
pnpm --filter @local-anonymizer/server test
pnpm --filter @local-anonymizer/worker test
pnpm --filter @local-anonymizer/app     test
```

Test categories:

- **Unit tests** – schema validation (`shared`), `PresidioClient` (mocked fetch), `processFile` pipeline (mocked fs + fetch)
- **Integration tests** – API endpoints with an in-memory SQLite database (`server`)
- **PII leakage guard** – verifies that fixture PII (`john.smith@example.com`, `+1-555-123-4567`) never appears in stored DB columns or API responses (`server/src/test/pii-guard.test.ts`, `worker/src/test/pii-guard.test.ts`)

### Reset local data

```bash
./infra/scripts/reset-volumes.sh
```

---

## Troubleshooting

### Worker does not pick up files

- **Permissions**: Ensure the host `UPLOADS_DIR` is readable by the Docker user. On Linux, run `chmod 777 infra/volumes/uploads` if needed.
- **Windows path mapping**: Use Unix-style paths in `.env` (e.g. `UPLOADS_DIR=./infra/volumes/uploads`) – Docker Desktop translates these automatically.
- **Polling**: The worker uses `chokidar` in polling mode (`usePolling: true`) so it works on network drives and Windows NTFS. If you increased `pollIntervalMs`, files won't be detected until the next poll tick.

### Presidio container not healthy

```bash
# Check health status
docker compose ps

# View Presidio logs
docker compose logs presidio-analyzer
docker compose logs presidio-anonymizer
```

The analyzer downloads spaCy language models on first start, which can take 1–2 minutes. Wait for `healthy` status before dropping files.

### SQLite database issues

```bash
# Reset all local data (stops containers, clears volumes)
./infra/scripts/reset-volumes.sh

# Restart
docker compose up --build
```

---

## Privacy guarantees

See [SECURITY.md](./SECURITY.md) for the full no-PII logging policy and threat model.

- **No PII in logs**: only the SHA-256 hash of the original filename, byte size, and processing status are stored in the database.
- **Anonymized delivery only**: the payload sent to `TARGET_URL` contains Presidio-anonymized messages – raw content is never delivered.
- **No telemetry**: nothing is sent to external services except the configured Delivery Targets (or the legacy `TARGET_URL`).

---

## License

MIT