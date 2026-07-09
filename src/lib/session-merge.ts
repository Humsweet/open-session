import { scanAllSessions, ToolType } from '@/lib/parsers';
import { getDb } from '@/lib/db/client';
import { SessionStatus, UnifiedSession } from '@/lib/parsers/types';
import { HostFilter } from '@/lib/parsers/session-roots';
import { persistSessionStatus, persistSessionsClosed } from '@/lib/session-state';
import { isSummaryHelperSession } from '@/lib/summarizer/session-kind';
import { getSessionUsageMany } from '@/lib/usage/store';
import { syncSessionUsage } from '@/lib/usage/sync';

// Re-exported so existing importers (e.g. the /api/sessions route) keep a stable
// path; the canonical definition lives in parsers/session-roots.ts alongside host.
export type { HostFilter };

export function parseAsUtc(s: string): number {
  // SQLite datetime('now') produces "YYYY-MM-DD HH:MM:SS" without timezone —
  // JS parses that as local time. Normalize to UTC by appending 'Z'.
  if (s && !s.endsWith('Z') && !s.includes('+') && !s.includes('T')) {
    return new Date(s.replace(' ', 'T') + 'Z').getTime();
  }
  return new Date(s).getTime();
}

function hasSessionActivitySinceStatusChange(sessionUpdatedAt: string, statusUpdatedAt?: string | null) {
  if (!statusUpdatedAt) return false;

  const sessionTime = parseAsUtc(sessionUpdatedAt);
  const statusTime = parseAsUtc(statusUpdatedAt);

  if (Number.isNaN(sessionTime) || Number.isNaN(statusTime)) {
    return false;
  }

  return sessionTime > statusTime;
}

/**
 * Scan every tool's sessions and overlay persisted DB state (status, summary,
 * title, pinned). This is the single source of truth for a session's *effective*
 * state — shared by the sessions list API and the projects API so their notion
 * of "open" never drifts apart. Side effects (force-close summary-helper
 * sessions, auto-reopen sessions with activity after a manual close) are
 * idempotent, so calling this from multiple endpoints is safe.
 *
 * `host` filters by which machine the session came from — defaults to 'local'
 * so the main list is unaffected by any mac-mini mirror; the daily digest passes
 * 'all' (or 'mac-mini') to reach the mirrored sessions.
 */
export async function loadMergedSessions(toolFilter?: ToolType, host: HostFilter = 'local'): Promise<UnifiedSession[]> {
  // Host selection happens at root level inside the scan (mac-mini roots aren't
  // even opened for a 'local' scan), so there is no post-scan discard here.
  const scanned = await scanAllSessions(toolFilter, host);

  const summaryHelperIds = scanned.filter(isSummaryHelperSession).map(session => session.id);
  if (summaryHelperIds.length > 0) {
    persistSessionsClosed(summaryHelperIds);
  }

  const db = getDb();
  const states = db.prepare('SELECT * FROM session_state').all() as Array<{
    session_id: string;
    status: string;
    summary: string | null;
    custom_title: string | null;
    summary_title_applied: number;
    pinned: number;
    status_updated_at: string | null;
  }>;
  const stateMap = new Map(states.map(s => [s.session_id, s]));

  const merged = scanned.map(s => {
    const state = stateMap.get(s.id);
    const forcedClosed = isSummaryHelperSession(s);
    const autoReopened =
      !forcedClosed &&
      state?.status === 'closed' &&
      hasSessionActivitySinceStatusChange(s.updatedAt, state.status_updated_at);

    if (autoReopened) {
      persistSessionStatus(s.id, 'open');
    }

    return {
      ...s,
      status: forcedClosed ? 'closed' : autoReopened ? 'open' : (state?.status as SessionStatus) || s.status,
      summary: state?.summary || s.summary,
      title: state?.custom_title || s.title,
      summaryTitleApplied: Boolean(state?.summary_title_applied),
      pinned: Boolean(state?.pinned),
    };
  });

  // Best-effort background refresh (throttled, not awaited — never slow down
  // this response for a subprocess call). Whatever it finds lands in the cache
  // for the *next* load; this response serves whatever is already cached below.
  void syncSessionUsage(merged);

  const usageMap = getSessionUsageMany(merged.map(s => s.id));
  return merged.map(s => {
    const usage = usageMap.get(s.id);
    return usage
      ? { ...s, usage: { totalTokens: usage.totalTokens, costUsd: usage.costUsd, model: usage.model } }
      : s;
  });
}
