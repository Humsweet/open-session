import { getDb } from '../db/client';

export interface SessionUsage {
  sessionId: string;
  fileKey: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd: number;
  syncedAt: string;
}

interface UsageRow {
  session_id: string;
  file_key: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost_usd: number;
  synced_at: string;
}

function rowToUsage(row: UsageRow): SessionUsage {
  return {
    sessionId: row.session_id,
    fileKey: row.file_key,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    totalTokens: row.total_tokens,
    costUsd: row.cost_usd,
    syncedAt: row.synced_at,
  };
}

export function getSessionUsage(sessionId: string): SessionUsage | null {
  const row = getDb()
    .prepare('SELECT * FROM session_usage WHERE session_id = ?')
    .get(sessionId) as UsageRow | undefined;
  return row ? rowToUsage(row) : null;
}

/** Batch lookup, e.g. to annotate a whole session list or sum up a day's digest. */
export function getSessionUsageMany(sessionIds: string[]): Map<string, SessionUsage> {
  if (sessionIds.length === 0) return new Map();
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT * FROM session_usage WHERE session_id IN (${placeholders})`)
    .all(...sessionIds) as UsageRow[];
  return new Map(rows.map(row => [row.session_id, rowToUsage(row)]));
}

export function upsertSessionUsage(usage: Omit<SessionUsage, 'syncedAt'>): void {
  getDb()
    .prepare(
      `INSERT INTO session_usage
         (session_id, file_key, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_tokens, cost_usd, synced_at)
       VALUES (@sessionId, @fileKey, @model, @inputTokens, @outputTokens, @cacheCreationTokens, @cacheReadTokens, @totalTokens, @costUsd, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(session_id) DO UPDATE SET
         file_key = excluded.file_key,
         model = excluded.model,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         cache_creation_tokens = excluded.cache_creation_tokens,
         cache_read_tokens = excluded.cache_read_tokens,
         total_tokens = excluded.total_tokens,
         cost_usd = excluded.cost_usd,
         synced_at = excluded.synced_at`
    )
    .run(usage);
}

export interface UsageSummary {
  totalTokens: number;
  costUsd: number;
  /** How many of the given session ids actually had cached usage data — lets
   * callers show an honest "N/M sessions have usage data" instead of silently
   * treating missing data as zero. */
  sessionsMatched: number;
}

/** Sum cached usage across a set of sessions (e.g. one digest day's sessions). */
export function summarizeUsage(sessionIds: string[]): UsageSummary {
  const usageMap = getSessionUsageMany(sessionIds);
  let totalTokens = 0;
  let costUsd = 0;
  for (const usage of usageMap.values()) {
    totalTokens += usage.totalTokens;
    costUsd += usage.costUsd;
  }
  return { totalTokens, costUsd, sessionsMatched: usageMap.size };
}
