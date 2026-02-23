import Database from 'better-sqlite3'
import path from 'node:path'
import { DB_FILENAME } from '@local-anonymizer/shared'

const DATA_DIR = process.env.DATA_DIR ?? './data'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  const dbPath = path.join(DATA_DIR, DB_FILENAME)
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  migrate(_db)
  return _db
}

/** Override the database instance (used in tests). */
export function setDb(db: Database.Database): void {
  _db = db
  migrate(db)
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS delivery_targets (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      method      TEXT NOT NULL DEFAULT 'POST',
      headers     TEXT NOT NULL DEFAULT '{}',
      auth        TEXT NOT NULL DEFAULT '{"type":"none"}',
      timeout_ms  INTEGER NOT NULL DEFAULT 15000,
      retries     INTEGER NOT NULL DEFAULT 0,
      backoff_ms  INTEGER NOT NULL DEFAULT 1000,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processing_runs (
      id                   TEXT PRIMARY KEY,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      source_type          TEXT NOT NULL DEFAULT 'folderUpload',
      source_file_name     TEXT NOT NULL,
      source_file_size     INTEGER NOT NULL,
      status               TEXT NOT NULL DEFAULT 'queued',
      error_code           TEXT,
      error_message_safe   TEXT,
      presidio_stats       TEXT,
      delivery_status_code INTEGER,
      delivery_duration_ms INTEGER,
      duration_ms          INTEGER
    );

    CREATE TABLE IF NOT EXISTS audit_log_events (
      id          TEXT PRIMARY KEY,
      timestamp   TEXT NOT NULL,
      level       TEXT NOT NULL DEFAULT 'info',
      run_id      TEXT,
      event_type  TEXT NOT NULL,
      meta        TEXT
    );
  `)
}
