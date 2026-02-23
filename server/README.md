# API Server

The `@local-anonymizer/server` package is a Fastify-based REST API that serves as the **control plane** for the Local Anonymizer pipeline.

Both the UI and the worker process communicate with this server.

---

## Running

```bash
# development (auto-restart on change)
pnpm dev

# production
pnpm build && pnpm start
```

Environment variables:

| Variable      | Default     | Description                         |
|---------------|-------------|-------------------------------------|
| `PORT`        | `3001`      | Port the server listens on          |
| `HOST`        | `0.0.0.0`   | Bind address                        |
| `DATA_DIR`    | `./data`    | Directory containing the SQLite DB  |
| `CORS_ORIGIN` | `*`         | Allowed CORS origin(s)              |

---

## Response Envelope

Every endpoint returns a consistent JSON envelope:

**Success**
```json
{ "ok": true, "data": <payload> }
```

**Error**
```json
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Human-readable description" } }
```

Common error codes:

| Code               | HTTP status | Meaning                              |
|--------------------|-------------|--------------------------------------|
| `VALIDATION_ERROR` | 400         | Request body or query string invalid |
| `NOT_FOUND`        | 404         | Resource does not exist              |
| `TARGET_DISABLED`  | 400         | Target is disabled (test endpoint)   |
| `DELIVERY_ERROR`   | 502         | Could not reach delivery target      |

---

## Endpoints

### Health

#### `GET /api/health`

Returns the server health status.

**Response**
```json
{ "ok": true, "data": { "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z" } }
```

---

### Config

The app config is a **singleton** stored in the database.

#### `GET /api/config`

Returns the current application configuration (merged with defaults).

**Response `data` shape**

| Field                | Type       | Default         | Description                                            |
|----------------------|------------|-----------------|--------------------------------------------------------|
| `watchFolderPath`    | `string`   | `/uploads`      | Container-internal path watched by the worker          |
| `deleteAfterSuccess` | `boolean`  | `false`         | Delete source file after successful delivery           |
| `deleteAfterFailure` | `boolean`  | `false`         | Delete source file after a failed run                  |
| `maxFileSizeBytes`   | `number`   | `10485760` (10 MB) | Maximum file size the worker will process           |
| `acceptedExtensions` | `string[]` | `[".json"]`     | File extensions accepted by the worker                 |
| `pollIntervalMs`     | `number`   | `5000`          | Polling interval used when FS events are unavailable   |

#### `PUT /api/config`

Partial update — only supplied fields are changed.

**Request body** — any subset of the config fields above.

---

### Delivery Targets

#### `GET /api/targets`

Returns all delivery targets ordered by creation date.

#### `POST /api/targets`

Creates a new delivery target.

**Request body**

| Field        | Type     | Required | Default        | Description                              |
|--------------|----------|----------|----------------|------------------------------------------|
| `name`       | `string` | ✓        |                | Human-readable label                     |
| `url`        | `string` | ✓        |                | Webhook URL                              |
| `method`     | `string` |          | `POST`         | HTTP method (`GET` or `POST`)            |
| `headers`    | `object` |          | `{}`           | Additional request headers               |
| `auth`       | `object` |          | `{type:"none"}`| Auth config (see below)                  |
| `timeoutMs`  | `number` |          | `15000`        | Request timeout in ms                    |
| `retries`    | `number` |          | `0`            | Number of retry attempts                 |
| `backoffMs`  | `number` |          | `1000`         | Delay between retries in ms              |
| `enabled`    | `boolean`|          | `true`         | Whether the target is active             |

**Auth types**

```json
{ "type": "none" }
{ "type": "bearerToken", "token": "<token>" }
{ "type": "apiKeyHeader", "header": "X-API-Key", "key": "<key>" }
{ "type": "basic", "username": "user", "password": "pass" }
```

#### `PUT /api/targets/:id`

Partial update of a delivery target. Returns the updated target.

#### `DELETE /api/targets/:id`

Deletes a delivery target. Returns `{ "ok": true, "data": null }`.

#### `POST /api/targets/:id/test`

Sends a minimal **test payload** (no PII) to the target's URL and returns the HTTP status code.

```json
{ "test": true, "source": "local-anonymizer", "timestamp": "..." }
```

**Response `data`**
```json
{ "statusCode": 200, "ok": true }
```

---

### Processing Runs

#### `GET /api/runs`

Returns a list of processing runs, newest first.

**Query parameters**

| Parameter | Type     | Description                                    |
|-----------|----------|------------------------------------------------|
| `limit`   | `number` | Max results (default `50`, max `200`)          |
| `status`  | `string` | Filter by status (see statuses below)          |
| `q`       | `string` | Search in `sourceFileName`                     |

**Run statuses**: `queued` · `processing` · `anonymized` · `delivered` · `failed` · `deleted`

#### `GET /api/runs/:id`

Returns a single processing run.

**Run object fields**

| Field                | Type     | Description                                              |
|----------------------|----------|----------------------------------------------------------|
| `id`                 | UUID     |                                                          |
| `createdAt`          | datetime |                                                          |
| `updatedAt`          | datetime |                                                          |
| `sourceType`         | string   | Always `folderUpload`                                    |
| `sourceFileName`     | string   | Sanitized reference (hash prefix, no raw path/content)   |
| `sourceFileSize`     | number   | File size in bytes                                       |
| `status`             | string   | Current status                                           |
| `errorCode`          | string?  | Machine-readable error code                              |
| `errorMessageSafe`   | string?  | Safe, non-PII error description                          |
| `presidioStats`      | object?  | Entity type → count map from Presidio                    |
| `deliveryStatusCode` | number?  | HTTP status returned by the delivery target              |
| `deliveryDurationMs` | number?  | Delivery request duration in ms                          |
| `durationMs`         | number?  | Total processing duration in ms                          |

#### `POST /api/runs` *(worker internal)*

Creates a new processing run. Called by the worker at the start of processing.

#### `PATCH /api/runs/:id` *(worker internal)*

Updates a run's status and metadata fields. Called by the worker at each pipeline stage.

---

### Audit Log Events

#### `GET /api/logs`

Returns audit log events, newest first.

**Query parameters**

| Parameter | Type | Description                                    |
|-----------|------|------------------------------------------------|
| `runId`   | UUID | Filter events belonging to a specific run      |
| `limit`   | number | Max results (default `100`, max `500`)       |

**Event types**: `file_detected` · `anonymize_started` · `anonymize_succeeded` · `delivery_started` · `delivery_succeeded` · `cleanup_deleted` · `run_failed`

**Levels**: `info` · `warn` · `error`

> **Privacy guarantee**: The `meta` field never contains raw file content or PII — only counts, codes, and durations.

---

## Database Schema

The server uses **SQLite** (via `better-sqlite3`). The database file is stored at `$DATA_DIR/local-anonymizer.db`.

Tables:

- `app_config` — key/value singleton config
- `delivery_targets` — delivery target definitions
- `processing_runs` — one row per processed file (no raw content)
- `audit_log_events` — append-only event log (no raw content)

---

## Running Tests

```bash
pnpm test
```

Integration tests use an in-memory SQLite database via Fastify's `inject()` (no real HTTP server required).
