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

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS log_entries (
      id          TEXT PRIMARY KEY,
      file_name_hash TEXT NOT NULL,
      byte_size   INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}
