import fs from 'fs';
import { UnifiedSession } from '../parsers/types';
import { fetchCcusageSessions, CcusageSessionRow } from './ccusage-client';
import { upsertSessionUsage } from './store';

// Opportunistic syncs (from browsing the session list) are throttled to this
// interval so ordinary use doesn't spawn a ccusage process on every request.
// Digest generation (opts.force) always bypasses this — it's an explicit,
// infrequent user action where fresh numbers matter.
const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;

let lastSyncedAt = 0;
let inFlight: Promise<void> | null = null;

function fileKeyOf(rawPath: string): string {
  try {
    const stat = fs.statSync(rawPath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

/** Claude Code only — see the mapping note in ccusage-client.ts. */
function toSessionId(row: CcusageSessionRow): string | null {
  return row.agent === 'claude' ? `claude-${row.period}` : null;
}

async function doSync(sessions: UnifiedSession[]): Promise<void> {
  const claudeSessionsById = new Map(sessions.filter(s => s.tool === 'claude-code').map(s => [s.id, s]));
  if (claudeSessionsById.size === 0) return;

  const rows = await fetchCcusageSessions();
  for (const row of rows) {
    const sessionId = toSessionId(row);
    if (!sessionId) continue; // unmapped agent (see toSessionId)
    const session = claudeSessionsById.get(sessionId);
    if (!session) continue; // not one of the sessions we were asked about

    upsertSessionUsage({
      sessionId,
      fileKey: fileKeyOf(session.rawPath),
      model: row.modelsUsed[0] || '',
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      totalTokens: row.totalTokens,
      costUsd: row.totalCost,
    });
  }
}

/**
 * Refresh the session_usage cache from ccusage. Pure script, zero LLM calls —
 * safe to call as often as needed; `force` aside, callers should treat this as
 * fire-and-forget best-effort enrichment, not something the response should
 * wait on.
 *
 * - `force: true` (daily digest generation): always runs, so the digest's usage
 *   numbers are fresh at the moment the user clicked "总结".
 * - `force: false` (default; opportunistic calls from session list/detail
 *   loads): throttled to once per 5 minutes so routine browsing never spawns a
 *   subprocess per request.
 *
 * ccusage being missing/erroring is swallowed and logged — usage data is a
 * nice-to-have annotation, never allowed to break session listing or digest
 * generation.
 */
export async function syncSessionUsage(
  sessions: UnifiedSession[],
  opts: { force?: boolean } = {}
): Promise<void> {
  const now = Date.now();
  if (!opts.force && now - lastSyncedAt < MIN_SYNC_INTERVAL_MS) return;
  if (inFlight) return inFlight;

  lastSyncedAt = now;
  inFlight = doSync(sessions)
    .catch(error => {
      console.warn(`[usage] ccusage 同步失败(不影响会话列表/总结生成): ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
