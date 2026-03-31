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
      summary TEXT,
      custom_title TEXT,
      summary_title_applied INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const columns = db.prepare("PRAGMA table_info(session_state)").all() as Array<{ name: string }>;
  const hasSummaryTitleApplied = columns.some(column => column.name === 'summary_title_applied');
  if (!hasSummaryTitleApplied) {
    db.exec("ALTER TABLE session_state ADD COLUMN summary_title_applied INTEGER NOT NULL DEFAULT 0");
  }

  // Set defaults
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('summary_cli', 'claude-code');
}
