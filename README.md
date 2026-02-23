# local-anonymizer

A **local, OS-agnostic** application that watches a folder for uploaded chat-log files (JSON), anonymizes PII using **Microsoft Presidio**, delivers the sanitized payloads to a configurable HTTP endpoint, and provides a web UI for configuration and monitoring.

Everything runs in Docker containers – no Python, Rust, or native dependencies required on the host.

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
│   ├── pages/
│   ├── nuxt.config.ts
│   └── Dockerfile
├── server/                # Fastify API + SQLite
│   ├── src/
│   │   ├── index.ts
│   │   ├── db.ts
│   │   └── routes/
│   └── Dockerfile
├── worker/                # File watcher + processing pipeline
│   ├── src/
│   │   ├── index.ts       # chokidar watcher (cross-platform)
│   │   └── processor.ts   # Presidio pipeline + delivery
│   └── Dockerfile
├── shared/                # Zod schemas, types, constants, utilities
│   └── src/
├── infra/
│   ├── volumes/
│   │   ├── uploads/       # Bind-mounted into worker container
│   │   └── data/          # SQLite database persistence
│   └── scripts/
│       └── reset-volumes.sh
├── docker-compose.yml
├── .env.example
└── pnpm-workspace.yaml
```

---

## First-run guide

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / macOS) or Docker Engine + Compose plugin (Linux)
- No other tools required on the host

### 1. Clone and configure

```bash
git clone https://github.com/julienreichel/local-anonymizer.git
cd local-anonymizer

# Copy the example environment file and edit as needed
cp .env.example .env
```

Open `.env` in your editor and set at minimum:

```dotenv
# Where the worker watches for new JSON files (absolute or relative path)
UPLOADS_DIR=./infra/volumes/uploads

# Where processed files land after anonymization (optional – leave blank to skip)
TARGET_URL=https://your-ingest-endpoint.example.com/ingest

# Optional Bearer token for the delivery endpoint
TARGET_AUTH_HEADER=Bearer eyJhb...
```

### 2. Start all services

```bash
docker compose up --build
```

> **First run** downloads the Presidio images (~1 GB) and builds the three custom images. Subsequent runs are much faster.

### 3. Open the UI

Once all services are healthy, open your browser to:

```
http://localhost:3000
```

From the dashboard you can:
- View processing statistics (total / delivered / failed / pending)
- Browse processing logs (file hash, size, status – no PII stored)
- Update the target URL and authentication header

### 4. Drop a file to test

Copy a JSON chat log into the uploads folder:

```bash
# Example chat log
cat > infra/volumes/uploads/test.json <<'EOF'
{
  "messages": [
    { "id": "1", "role": "user",      "content": "Hi, my name is John Smith and my email is john@example.com." },
    { "id": "2", "role": "assistant", "content": "Hello! How can I help you today?" }
  ]
}
EOF
```

The worker will pick it up within 5 seconds, anonymize it, post it to `TARGET_URL` (if configured), log the result, and delete the original file.

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

### Reset local data

```bash
./infra/scripts/reset-volumes.sh
```

---

## Chat log format

The worker accepts JSON files matching this schema:

```json
{
  "messages": [
    {
      "id": "string (required)",
      "role": "user | assistant | system (required)",
      "content": "string (required)",
      "timestamp": "ISO-8601 (optional)"
    }
  ],
  "version": "string (optional)",
  "metadata": { "...": "any (optional)" }
}
```

---

## Privacy guarantees

- **No PII in logs**: only the SHA-256 hash of the original filename, the byte size, and processing status are stored in the database.
- **Original files deleted** after successful delivery.
- **No telemetry**: nothing is sent to external services except the configured `TARGET_URL`.

---

## License

MIT