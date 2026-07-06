import { getDb } from '../db/client';
import { DailyDigest, DigestItem, SourceCoverage } from './types';

interface DigestRow {
  date: string;
  headline: string;
  items_json: string;
  coverage_json: string;
  session_count: number;
  model: string;
  status: string;
  generated_at: string;
  updated_at: string;
}

function rowToDigest(row: DigestRow): DailyDigest {
  return {
    date: row.date,
    headline: row.headline,
    items: JSON.parse(row.items_json) as DigestItem[],
    coverage: JSON.parse(row.coverage_json) as Record<string, SourceCoverage>,
    sessionCount: row.session_count,
    model: row.model,
    status: row.status as DailyDigest['status'],
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  };
}

export function getDigest(date: string): DailyDigest | null {
  const row = getDb()
    .prepare('SELECT * FROM daily_digest WHERE date = ?')
    .get(date) as DigestRow | undefined;
  return row ? rowToDigest(row) : null;
}

/** All stored digests, newest day first. */
export function listDigests(): DailyDigest[] {
  const rows = getDb()
    .prepare('SELECT * FROM daily_digest ORDER BY date DESC')
    .all() as DigestRow[];
  return rows.map(rowToDigest);
}

/** The set of dates that already have a *complete* digest (used by the scheduler
 * to skip finished days; partial days are intentionally excluded so they get
 * retried until their pending source is captured). */
export function completeDigestDates(): Set<string> {
  const rows = getDb()
    .prepare("SELECT date FROM daily_digest WHERE status IN ('complete','empty')")
    .all() as Array<{ date: string }>;
  return new Set(rows.map(r => r.date));
}

export function saveDigest(d: DailyDigest): void {
  getDb()
    .prepare(
      `INSERT INTO daily_digest
         (date, headline, items_json, coverage_json, session_count, model, status, generated_at, updated_at)
       VALUES (@date, @headline, @items_json, @coverage_json, @session_count, @model, @status, @generated_at, @updated_at)
       ON CONFLICT(date) DO UPDATE SET
         headline = excluded.headline,
         items_json = excluded.items_json,
         coverage_json = excluded.coverage_json,
         session_count = excluded.session_count,
         model = excluded.model,
         status = excluded.status,
         updated_at = excluded.updated_at`
    )
    .run({
      date: d.date,
      headline: d.headline,
      items_json: JSON.stringify(d.items),
      coverage_json: JSON.stringify(d.coverage),
      session_count: d.sessionCount,
      model: d.model,
      status: d.status,
      generated_at: d.generatedAt,
      updated_at: d.updatedAt,
    });
}

export function getBlurbCache(sessionId: string, fileKey: string): string | null {
  const row = getDb()
    .prepare('SELECT file_key, blurb FROM digest_session_cache WHERE session_id = ?')
    .get(sessionId) as { file_key: string; blurb: string } | undefined;
  if (!row || row.file_key !== fileKey) return null;
  return row.blurb;
}

export function setBlurbCache(sessionId: string, fileKey: string, blurb: string, model: string): void {
  getDb()
    .prepare(
      `INSERT INTO digest_session_cache (session_id, file_key, blurb, model)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET file_key = excluded.file_key, blurb = excluded.blurb, model = excluded.model`
    )
    .run(sessionId, fileKey, blurb, model);
}
