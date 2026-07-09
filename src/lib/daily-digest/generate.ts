import fs from 'fs';
import { scanAllSessions, getSessionDetail } from '../parsers';
import { readAllCachedSessions } from '../parsers/scan-cache';
import { isI2mProject } from '../agent-remote';
import { UnifiedSession } from '../parsers/types';
import { isSyntheticDigestSession } from '../parsers/synthetic-sessions';
import { getSetting } from '../db/client';
import { runDigestText } from '../summarizer/runtime';
import {
  buildSessionBlurbPrompt,
  buildDayRollupPrompt,
  DayRollupSessionLine,
  VALUE_LINES,
  VALUE_TIERS,
  WORK_CATEGORIES,
} from './rubric';
import { DailyDigest, DigestItem, DigestUsage, SourceCoverage, ValueLine, ValueTier, WorkCategory } from './types';
import { getBlurbCache, setBlurbCache, saveDigest } from './store';
import { readPrinciples } from './principles';
import { exportDigestToObsidian } from './obsidian-export';
import { syncSessionUsage } from '../usage/sync';
import { summarizeUsage } from '../usage/store';

/** digest 入库后，把当天镜像成 Obsidian 里的一张表。纯下游产物：写失败只告警，
 *  绝不影响已落库的 digest（digest 才是真相源）。 */
function mirrorToObsidian(digest: DailyDigest): void {
  try {
    const res = exportDigestToObsidian(digest);
    if (res.written) console.log(`[daily-digest] Obsidian 表格已写入 ${res.path}`);
  } catch (e) {
    console.warn(`[daily-digest] Obsidian 导出失败（不影响入库）: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const BLURB_CONCURRENCY = 6;
const BLURB_TIMEOUT_MS = 150000;
// A busy day can hand opus 40+ blurbs to classify/rank in one call; opus may also
// engage extended thinking. Give it real headroom so a busy day doesn't fail.
const ROLLUP_TIMEOUT_MS = 420000;

/** YYYY-MM-DD in the machine's LOCAL timezone. Sessions are bucketed by the day
 * they *started* (createdAt), so a session running past midnight stays on its
 * start day — exactly the "算今天，哪怕过 12 点" behavior we want. */
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A session that is a spawned subagent transcript, not a top-level work item. */
function isSubagentSession(s: UnifiedSession): boolean {
  return s.rawPath.includes('/subagents/') || s.rawPath.includes('\\subagents\\');
}

function projectName(cwd: string): string {
  if (!cwd) return '(unknown)';
  const parts = cwd.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || cwd;
}

function fileKeyOf(rawPath: string): string {
  try {
    const st = fs.statSync(rawPath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'missing';
  }
}

/** Sessions that count toward a digest: exclude i2m (GrokStuff, detected by cwd
 * so it holds whether or not agent-remote enrichment ran) and subagent
 * transcripts. Works on an already-loaded list so one load feeds many days. */
export function countedFrom(all: UnifiedSession[]): UnifiedSession[] {
  return all.filter(s => !isI2mProject(s.cwd) && !isSubagentSession(s) && !isSyntheticDigestSession(s));
}

/** Dedup sessions that appear in more than one root (e.g. live local + backup
 * SSD copy of the same id): keep the live (non-archived) copy, else the most
 * recently updated. readAllCachedSessions does no dedup of its own. */
function dedupById(sessions: UnifiedSession[]): UnifiedSession[] {
  const byId = new Map<string, UnifiedSession>();
  for (const s of sessions) {
    const cur = byId.get(s.id);
    if (!cur) { byId.set(s.id, s); continue; }
    const better =
      Boolean(cur.archived) !== Boolean(s.archived)
        ? (cur.archived ? s : cur)
        : (new Date(s.updatedAt).getTime() > new Date(cur.updatedAt).getTime() ? s : cur);
    byId.set(s.id, better);
  }
  return [...byId.values()];
}

/**
 * The session source for digests, built on the scan-cache INDEX rather than a
 * live walk of every root. It refreshes only the fast local-disk roots (live
 * local + mac-mini mirror) into the index, then reads the whole index — so the
 * slow external-SSD archive (thousands of files, minutes to stat) is served from
 * its last index rather than re-walked every run. This turns a ~7-minute scan
 * into ~1s while staying complete and fresh for the sources that actually change.
 */
export async function loadDigestSessions(): Promise<UnifiedSession[]> {
  await scanAllSessions(undefined, 'all', false); // includeArchived=false; side effect: refresh index for fast roots
  return dedupById(readAllCachedSessions());
}

/**
 * Collect the top-level work sessions that STARTED on `date` (local tz), across
 * all hosts, excluding i2m and subagents. Pass `all` (a prior loadDigestSessions
 * result) to reuse one load across a batch of days; omit it to load now.
 */
export async function collectDaySessions(date: string, all?: UnifiedSession[]): Promise<UnifiedSession[]> {
  const scanned = all ?? (await loadDigestSessions());
  return countedFrom(scanned)
    .filter(s => localDateKey(s.createdAt) === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Backfill `usage` on a digest generated before token/cost tracking existed
 * (usage undefined). Pure data — re-collects that day's sessions (cache read,
 * no LLM), syncs the ccusage cache, sums it, and persists so this only ever
 * runs once per historical day. A no-op if usage is already present. Pass a
 * prior `loadDigestSessions()` result to reuse one scan across many days (see
 * the /api/daily list route).
 */
export async function ensureDigestUsage(digest: DailyDigest, all?: UnifiedSession[]): Promise<DailyDigest> {
  if (digest.usage) return digest;

  const sessions = await collectDaySessions(digest.date, all);
  await syncSessionUsage(sessions);
  const usage: DigestUsage = { ...summarizeUsage(sessions.map(s => s.id)), sessionsTotal: sessions.length };

  const withUsage: DailyDigest = { ...digest, usage };
  saveDigest(withUsage);
  return withUsage;
}

async function condenseSession(s: UnifiedSession, model: string): Promise<string> {
  const fileKey = fileKeyOf(s.rawPath);
  const cached = getBlurbCache(s.id, fileKey);
  if (cached) return cached;

  const detail = await getSessionDetail(s.id);
  const messagesPreview = (detail?.messages ?? [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(0, 20)
    .map(m => `[${m.role}]: ${m.content.slice(0, 200)}`)
    .join('\n')
    .slice(0, 3000);

  const prompt = buildSessionBlurbPrompt({
    tool: s.tool,
    host: s.host || 'local',
    project: projectName(s.cwd),
    createdAt: s.createdAt,
    messageCount: s.messageCount,
    firstUserMessage: s.firstUserMessage,
    lastUserMessage: s.lastUserMessage,
    messagesPreview,
  });

  const blurb = (await runDigestText(prompt, model, BLURB_TIMEOUT_MS)).trim();
  if (blurb) setBlurbCache(s.id, fileKey, blurb, model);
  return blurb;
}

/** Run async tasks with a bounded concurrency. Failures resolve to null so one
 * bad session never sinks the whole day. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        results[i] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface RollupItem {
  source_indices: number[];
  title: string;
  line: string;
  tier: string;
  category: string;
  value_point: string;
  what: string;
}

function extractJson(text: string): { headline: string; items: RollupItem[] } {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const parsed = JSON.parse(raw) as { headline?: string; items?: RollupItem[] };
  return { headline: parsed.headline || '', items: Array.isArray(parsed.items) ? parsed.items : [] };
}

function coerceLine(v: string): ValueLine {
  return (VALUE_LINES as readonly string[]).includes(v) ? (v as ValueLine) : 'consumption';
}
function coerceTier(v: string): ValueTier {
  return (VALUE_TIERS as readonly string[]).includes(v) ? (v as ValueTier) : 'B';
}
function coerceCategory(v: string): WorkCategory {
  return (WORK_CATEGORIES as readonly string[]).includes(v) ? (v as WorkCategory) : 'ops';
}

const TIER_RANK: Record<ValueTier, number> = { S: 0, A: 1, B: 2 };
const LINE_RANK: Record<ValueLine, number> = { career: 0, personal: 1, consumption: 2 };

export interface GenerateOptions {
  /** Overrides the digest model setting (mainly for tests). */
  model?: string;
  /** A prior loadDigestSessions() result, so a caller can pay the expensive scan
   * once and generate from it. Omit to scan now. */
  scannedSessions?: UnifiedSession[];
}

/**
 * Generate (or regenerate) the digest for one day and persist it. Idempotent:
 * per-session blurbs are cached, so re-running only re-does the rollup unless a
 * transcript changed. Manual single-day generation only — no backfill, no
 * mac-mini pending/partial machinery: a day is 'complete' if any session counts,
 * else 'empty'. Whatever sessions are visible at generation time (local + any
 * mounted backup roots) is what gets summarized.
 */
export async function generateDigest(date: string, opts: GenerateOptions = {}): Promise<DailyDigest> {
  const model = opts.model || getSetting('digest_model', 'opus');
  const sessions = await collectDaySessions(date, opts.scannedSessions);

  // Coverage is retained in the schema but no longer drives status: local is
  // always 'covered', and there is no pending/partial state to reconcile later.
  const coverage: Record<string, SourceCoverage> = { local: 'covered' };

  if (sessions.length === 0) {
    const empty: DailyDigest = {
      date,
      headline: '这天没有计入的 agent 工作',
      items: [],
      coverage,
      sessionCount: 0,
      model,
      status: 'empty',
      generatedAt: nowIso(),
      updatedAt: nowIso(),
      usage: { totalTokens: 0, costUsd: 0, sessionsMatched: 0, sessionsTotal: 0 },
    };
    saveDigest(empty);
    mirrorToObsidian(empty);
    return empty;
  }

  // ccusage 同步是纯脚本(零 LLM 调用),与 blurb 生成互不依赖,并发跑省墙钟时间。
  // force:true——这正是用户点「总结当日」的那一刻,数据要新鲜。
  const [blurbs] = await Promise.all([
    mapLimit(sessions, BLURB_CONCURRENCY, s => condenseSession(s, model)),
    syncSessionUsage(sessions, { force: true }),
  ]);

  const lines: DayRollupSessionLine[] = sessions.map((s, i) => ({
    index: i,
    project: projectName(s.cwd),
    tool: s.tool,
    host: s.host || 'local',
    createdAt: s.createdAt,
    blurb: blurbs[i] || `(未能浓缩，标题: ${s.title})`,
  }));

  const rollupText = await runDigestText(buildDayRollupPrompt(date, lines, readPrinciples()), model, ROLLUP_TIMEOUT_MS);
  const { headline, items: rawItems } = extractJson(rollupText);

  const items: DigestItem[] = rawItems.map(ri => {
    const idxs = (ri.source_indices || []).filter(i => i >= 0 && i < sessions.length);
    const srcs = idxs.map(i => sessions[i]);
    const primary = srcs[0];
    return {
      sessionIds: srcs.map(s => s.id),
      title: ri.title || primary?.title || '(untitled)',
      line: coerceLine(ri.line),
      tier: coerceTier(ri.tier),
      category: coerceCategory(ri.category),
      valuePoint: ri.value_point || '',
      what: ri.what || '',
      project: primary ? projectName(primary.cwd) : '(unknown)',
      tool: primary?.tool || '',
      host: primary?.host || 'local',
    };
  });

  items.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || LINE_RANK[a.line] - LINE_RANK[b.line]);

  const usage: DigestUsage = { ...summarizeUsage(sessions.map(s => s.id)), sessionsTotal: sessions.length };

  const digest: DailyDigest = {
    date,
    headline: headline || items[0]?.valuePoint || '',
    items,
    coverage,
    sessionCount: sessions.length,
    model,
    status: 'complete',
    generatedAt: nowIso(),
    updatedAt: nowIso(),
    usage,
  };
  saveDigest(digest);
  mirrorToObsidian(digest);
  return digest;
}
