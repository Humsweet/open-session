import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '', '.open-session');
const DB_PATH = path.join(DB_DIR, 'data.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_state (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'open',
      status_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      summary TEXT,
      custom_title TEXT,
      summary_title_applied INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      pinned_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const columns = db.prepare("PRAGMA table_info(session_state)").all() as Array<{ name: string }>;
  const hasSummaryTitleApplied = columns.some(column => column.name === 'summary_title_applied');
  const hasPinned = columns.some(column => column.name === 'pinned');
  const hasPinnedAt = columns.some(column => column.name === 'pinned_at');
  const hasStatusUpdatedAt = columns.some(column => column.name === 'status_updated_at');
  if (!hasStatusUpdatedAt) {
    db.exec("ALTER TABLE session_state ADD COLUMN status_updated_at TEXT");
    db.exec("UPDATE session_state SET status_updated_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) WHERE status_updated_at IS NULL");
  }
  if (!hasSummaryTitleApplied) {
    db.exec("ALTER TABLE session_state ADD COLUMN summary_title_applied INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasPinned) {
    db.exec("ALTER TABLE session_state ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasPinnedAt) {
    db.exec("ALTER TABLE session_state ADD COLUMN pinned_at TEXT");
  }

  // Migrate existing datetime('now') values (no timezone) to ISO 8601 UTC
  db.exec(`
    UPDATE session_state
    SET status_updated_at = replace(status_updated_at, ' ', 'T') || 'Z'
    WHERE status_updated_at IS NOT NULL
      AND status_updated_at NOT LIKE '%Z'
      AND status_updated_at LIKE '____-__-__ __:__:__'
  `);
  db.exec(`
    UPDATE session_state
    SET updated_at = replace(updated_at, ' ', 'T') || 'Z'
    WHERE updated_at IS NOT NULL
      AND updated_at NOT LIKE '%Z'
      AND updated_at LIKE '____-__-__ __:__:__'
  `);

  // Set defaults
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('summary_cli', 'claude-code');
}
