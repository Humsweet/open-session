import { NextRequest, NextResponse } from 'next/server';
import { scanAllSessions, ToolType } from '@/lib/parsers';
import { getTranscriptLower } from '@/lib/parsers/scan-cache';
import { getDb } from '@/lib/db/client';
import { SessionOrigin, SessionStatus } from '@/lib/parsers/types';
import { persistSessionStatus, persistSessionsClosed } from '@/lib/session-state';
import { isSummaryHelperSession } from '@/lib/summarizer/session-kind';

function parseAsUtc(s: string): number {
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

type SearchMatch = NonNullable<import('@/lib/parsers/types').UnifiedSession['matchedIn']>;

const MATCH_RANK: SearchMatch[] = ['title', 'summary', 'message', 'path', 'transcript'];

const CJK_CHAR = /^[぀-ヿ㐀-鿿豈-﫿]$/;

interface TermMatcher {
  term: string;
  test: (text: string) => boolean;
}

/**
 * CJK terms tolerate up to 2 characters between each query character, so
 * 整備品 still finds 整備済品 / 整備済製品 — people rarely remember the
 * exact official wording. Other terms use plain substring matching.
 */
function makeTermMatcher(term: string): TermMatcher {
  const chars = [...term];
  if (chars.length < 2 || !chars.every(c => CJK_CHAR.test(c))) {
    return { term, test: text => text.includes(term) };
  }
  const re = new RegExp(chars.join('[\\s\\S]{0,2}?'));
  return { term, test: text => re.test(text) };
}

/**
 * Every term must match somewhere (AND), but different terms may match
 * different fields. Returns the least prominent location among the terms —
 * that is what explains why the session is in the results.
 */
function matchSession(
  s: { title: string; summary?: string; firstUserMessage: string; lastUserMessage: string; cwd: string; rawPath: string },
  matchers: TermMatcher[]
): SearchMatch | null {
  const fields: Array<{ rank: number; text: string }> = [
    { rank: 0, text: s.title.toLowerCase() },
    { rank: 1, text: (s.summary || '').toLowerCase() },
    { rank: 2, text: (s.firstUserMessage + '\n' + s.lastUserMessage).toLowerCase() },
    { rank: 3, text: s.cwd.toLowerCase() },
  ];

  let worstRank = 0;
  const pending: TermMatcher[] = [];
  for (const matcher of matchers) {
    const hit = fields.find(f => matcher.test(f.text));
    if (hit) {
      worstRank = Math.max(worstRank, hit.rank);
    } else {
      pending.push(matcher);
    }
  }

  if (pending.length > 0) {
    // Cached lowercased transcript (terms are already lowercased upstream)
    const transcript = getTranscriptLower(s.rawPath);
    if (!pending.every(m => m.test(transcript))) return null;
    worstRank = 4;
  }

  return MATCH_RANK[worstRank];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const toolFilter = searchParams.get('tool') as ToolType | null;
    const statusFilter = searchParams.get('status') as SessionStatus | null;
    const originFilter = searchParams.get('origin') as SessionOrigin | null;
    const pinnedFilter = searchParams.get('pinned');
    const search = searchParams.get('search')?.toLowerCase();
    // Space-separated keywords are ANDed; each may match a different field
    const searchTerms = search?.split(/\s+/).filter(Boolean) ?? [];
    const sortBy = searchParams.get('sortBy') || 'updatedAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    let sessions = await scanAllSessions(toolFilter || undefined);
    const summaryHelperIds = sessions.filter(isSummaryHelperSession).map(session => session.id);

    if (summaryHelperIds.length > 0) {
      persistSessionsClosed(summaryHelperIds);
    }

    // Merge with persisted state from DB
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

    sessions = sessions.map(s => {
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

    // Apply filters
    if (statusFilter) {
      sessions = sessions.filter(s => s.status === statusFilter);
    }

    if (originFilter) {
      sessions = sessions.filter(s => s.origin === originFilter);
    }

    if (pinnedFilter === 'only') {
      sessions = sessions.filter(s => s.pinned);
    }

    if (searchTerms.length > 0) {
      const matchers = searchTerms.map(makeTermMatcher);
      sessions = sessions.flatMap(s => {
        const matchedIn = matchSession(s, matchers);
        return matchedIn ? [{ ...s, matchedIn }] : [];
      });
    }

    // Apply sorting
    const field = sortBy as 'updatedAt' | 'createdAt';
    sessions.sort((a, b) => {
      const pinnedDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (pinnedDiff !== 0) return pinnedDiff;

      const ta = new Date(a[field] || a.updatedAt).getTime();
      const tb = new Date(b[field] || b.updatedAt).getTime();
      return sortOrder === 'asc' ? ta - tb : tb - ta;
    });

    return NextResponse.json({ sessions, total: sessions.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
