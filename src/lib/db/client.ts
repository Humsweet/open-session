import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '', '.open-session');
const DB_PATH = path.join(DB_DIR, 'data.db');

let db: Database.Database | null = null;
let dbCleanupRegistered = false;

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);

  if (!dbCleanupRegistered) {
    dbCleanupRegistered = true;
    const closeDb = () => { if (db) { db.close(); db = null; } };
    process.once('exit', closeDb);
    process.once('SIGTERM', closeDb);
    process.once('SIGINT', closeDb);
  }

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

    -- Persistent metadata cache: one row per session file, so a fresh server
    -- process restores parsed metadata without re-reading every transcript.
    -- file_key is "mtimeMs:size" — a row is valid only while it matches the
    -- file on disk, so changed/growing files are re-parsed and nothing else is.
    CREATE TABLE IF NOT EXISTS scan_cache (
      raw_path TEXT PRIMARY KEY,
      file_key TEXT NOT NULL,
      session_json TEXT NOT NULL
    );

    -- One row per day: the classified/ranked daily work digest. items_json is a
    -- DigestItem[]; coverage_json records per-source capture state so a day whose
    -- mac-mini data wasn't reachable is stored as 'partial' (never falsely
    -- 'complete') and completed on a later run. See src/lib/daily-digest.
    CREATE TABLE IF NOT EXISTS daily_digest (
      date TEXT PRIMARY KEY,
      headline TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL DEFAULT '[]',
      coverage_json TEXT NOT NULL DEFAULT '{}',
      session_count INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'empty',
      generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    -- Per-session factual condensation cache, keyed by session id. file_key is
    -- "mtimeMs:size" (same scheme as scan_cache): a growing/edited transcript
    -- invalidates its blurb so it is re-condensed, and nothing else is. Makes
    -- digest (re)generation idempotent and cheap on tokens.
    CREATE TABLE IF NOT EXISTS digest_session_cache (
      session_id TEXT PRIMARY KEY,
      file_key TEXT NOT NULL,
      blurb TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT ''
    );

    -- User feedback on a single daily-digest item, keyed by the item's primary
    -- session id. Holds the user's verbatim comment plus optional tier/line
    -- corrections; later distilled into user-priority-principles.md (see
    -- src/lib/daily-digest/{feedback-store,principles}.ts).
    CREATE TABLE IF NOT EXISTS digest_item_feedback (
      session_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      item_title TEXT,
      ai_tier TEXT,
      ai_line TEXT,
      ai_category TEXT,
      comment TEXT,
      suggested_tier TEXT,
      suggested_line TEXT,
      updated_at TEXT NOT NULL
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
  // Model used for the daily work digest (per-session condensation + day rollup).
  // Defaults to opus while the value principles are being tuned; switch to
  // 'sonnet' etc. from the settings page once they stabilize. Accepts a CLI
  // alias ('opus'/'sonnet'/'haiku') or a full model id.
  insertSetting.run('digest_model', 'opus');
}

/** Read a settings value, falling back to the given default when unset. */
export function getSetting(key: string, fallback: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}
