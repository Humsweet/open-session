import * as fs from 'fs';
import * as path from 'path';
import { UnifiedSession } from './types';
import { getDb } from '../db/client';

/**
 * Session metadata cache keyed by file identity (mtimeMs + size) so repeated
 * scans only re-parse files that actually changed.
 *
 * The in-memory Map is the hot path within a process; it is backed by the
 * SQLite `scan_cache` table so a fresh process (launchd restart, reconcile
 * rebuild) restores all metadata without re-reading ~400MB of transcripts —
 * only files whose mtime/size changed since last run get re-parsed. Writes are
 * batched into one transaction on the next tick to avoid per-file fsyncs.
 */

interface ScanEntry {
  key: string;
  session: UnifiedSession;
}

const sessionCache = new Map<string, ScanEntry>();

function fileKey(stat: fs.Stats): string {
  return `${stat.mtimeMs}:${stat.size}`;
}

// --- SQLite persistence ----------------------------------------------------

let hydrated = false;

/** Load every persisted row into the in-memory Map once per process. */
function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true; // set first so a parse error can't trigger reload loops
  try {
    const rows = getDb()
      .prepare('SELECT raw_path, file_key, session_json FROM scan_cache')
      .all() as Array<{ raw_path: string; file_key: string; session_json: string }>;
    for (const row of rows) {
      try {
        sessionCache.set(row.raw_path, { key: row.file_key, session: JSON.parse(row.session_json) });
      } catch { /* skip a corrupt row; the file will just be re-parsed */ }
    }
  } catch { /* DB unavailable — fall back to a process-lifetime in-memory cache */ }
}

const pendingWrites = new Map<string, ScanEntry>();
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setImmediate(flushScanCache);
}

/** Commit queued metadata rows to SQLite in a single transaction. */
export function flushScanCache(): void {
  flushScheduled = false;
  if (pendingWrites.size === 0) return;
  const batch = [...pendingWrites.entries()];
  pendingWrites.clear();
  try {
    const db = getDb();
    const stmt = db.prepare(
      'INSERT INTO scan_cache (raw_path, file_key, session_json) VALUES (?, ?, ?) ' +
        'ON CONFLICT(raw_path) DO UPDATE SET file_key = excluded.file_key, session_json = excluded.session_json'
    );
    db.transaction(() => {
      for (const [rawPath, entry] of batch) {
        stmt.run(rawPath, entry.key, JSON.stringify(entry.session));
      }
    })();
  } catch { /* DB write failed — in-memory cache still serves this process */ }
}

export function getCachedSession(filePath: string, stat: fs.Stats): UnifiedSession | null {
  ensureHydrated();
  const entry = sessionCache.get(filePath);
  if (!entry || entry.key !== fileKey(stat)) return null;
  // Shallow copy: callers spread-merge DB state into these objects
  return { ...entry.session };
}

export function setCachedSession(filePath: string, stat: fs.Stats, session: UnifiedSession): void {
  ensureHydrated();
  const entry: ScanEntry = { key: fileKey(stat), session };
  sessionCache.set(filePath, entry);
  pendingWrites.set(filePath, entry);
  scheduleFlush();
}

/**
 * Transcript text cache for full-text search. Stores the lowercased
 * main transcript + all subagent transcripts as one string, evicting
 * least-recently-used entries past the byte budget. Search terms are
 * already lowercased by the API layer, and lowercasing is a no-op for
 * CJK, so matching against lowercased text is always correct.
 */

// Search normally runs through ripgrep (see transcript-search.ts), which keeps
// nothing in the Node heap. This cache only backs the rg-missing fallback, so a
// modest bound is plenty; LRU eviction keeps it from growing unbounded there.
const TRANSCRIPT_CACHE_MAX_BYTES = 128 * 1024 * 1024;

interface TranscriptEntry {
  key: string;
  text: string;
}

const transcriptCache = new Map<string, TranscriptEntry>();
let transcriptCacheBytes = 0;

function readTranscriptRaw(rawPath: string): string {
  let text = '';
  try {
    text = fs.readFileSync(rawPath, 'utf-8');
  } catch { /* unreadable main transcript */ }
  try {
    const subagentsDir = path.join(
      path.dirname(rawPath),
      path.basename(rawPath, '.jsonl'),
      'subagents'
    );
    if (fs.existsSync(subagentsDir)) {
      for (const f of fs.readdirSync(subagentsDir, { recursive: true }) as string[]) {
        if (!f.endsWith('.jsonl')) continue;
        try {
          text += '\n' + fs.readFileSync(path.join(subagentsDir, f), 'utf-8');
        } catch { /* skip unreadable subagent file */ }
      }
    }
  } catch { /* unreadable subagent dir */ }
  return text;
}

export function getTranscriptLower(rawPath: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(rawPath);
  } catch {
    return '';
  }

  const key = fileKey(stat);
  const cached = transcriptCache.get(rawPath);
  if (cached && cached.key === key) {
    // Refresh LRU position
    transcriptCache.delete(rawPath);
    transcriptCache.set(rawPath, cached);
    return cached.text;
  }

  if (cached) {
    transcriptCacheBytes -= cached.text.length * 2;
    transcriptCache.delete(rawPath);
  }

  const text = readTranscriptRaw(rawPath).toLowerCase();
  const bytes = text.length * 2;

  if (bytes <= TRANSCRIPT_CACHE_MAX_BYTES) {
    transcriptCache.set(rawPath, { key, text });
    transcriptCacheBytes += bytes;
    for (const [evictPath, entry] of transcriptCache) {
      if (transcriptCacheBytes <= TRANSCRIPT_CACHE_MAX_BYTES) break;
      if (evictPath === rawPath) continue;
      transcriptCacheBytes -= entry.text.length * 2;
      transcriptCache.delete(evictPath);
    }
  }

  return text;
}
