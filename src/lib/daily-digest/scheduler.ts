import { readAllCachedSessions } from '../parsers/scan-cache';
import { isI2mProject } from '../agent-remote';
import { getDb } from '../db/client';
import { UnifiedSession } from '../parsers/types';
import { localDateKey, generateDigest, countedFrom, loadDigestSessions } from './generate';
import { completeDigestDates, getDigest } from './store';

const LAST_RUN_KEY = 'digest_last_run';
const DEFAULT_MAX_DAYS = 4; // yesterday + ~3 backfill per run

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return localDateKey(d.toISOString());
}

function today(): string {
  return localDateKey(new Date().toISOString());
}

/**
 * Backfill horizon: the earliest day we should ever summarize. Per the product
 * decision this is the earliest mac-mini session (the mac-mini is the deepest
 * archive); we walk backward one batch per run until we reach it. Falls back to
 * the earliest counted session across all hosts if there is no mac-mini mirror.
 * i2m is excluded by cwd here because the cached rows carry the raw (pre-enrich)
 * origin — see readAllCachedSessions.
 */
function horizonFrom(sessions: UnifiedSession[]): string {
  const nonI2m = sessions.filter(s => !isI2mProject(s.cwd));
  const macMini = nonI2m.filter(s => s.host === 'mac-mini');
  const pool = macMini.length > 0 ? macMini : nonI2m;
  let earliest = today();
  for (const s of pool) {
    const d = localDateKey(s.createdAt);
    if (d < earliest) earliest = d;
  }
  return earliest;
}

/** Every day from horizon..newest, newest first. */
function dayRange(horizon: string, newest: string): string[] {
  const out: string[] = [];
  let d = newest;
  while (d >= horizon) {
    out.push(d);
    d = shiftDate(d, -1);
  }
  return out;
}

export interface SchedulerStatus {
  horizon: string;
  yesterday: string;
  totalDays: number;
  doneDays: number;
  partialDays: number;
  pendingDays: number;
  lastRun: string | null;
}

/**
 * Cheap status for the settings page: reads session metadata straight from the
 * scan cache (no file stat, so it never triggers the slow SSD walk) to compute
 * the horizon, then counts done/partial days from the digest table.
 */
export async function schedulerStatus(): Promise<SchedulerStatus> {
  const horizon = horizonFrom(readAllCachedSessions());
  const yesterday = shiftDate(today(), -1);
  const range = dayRange(horizon, yesterday);
  const done = completeDigestDates();

  let doneDays = 0;
  let partialDays = 0;
  for (const date of range) {
    if (done.has(date)) doneDays++;
    else if (getDigest(date)?.status === 'partial') partialDays++;
  }

  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(LAST_RUN_KEY) as
    | { value: string }
    | undefined;

  return {
    horizon,
    yesterday,
    totalDays: range.length,
    doneDays,
    partialDays,
    pendingDays: range.length - doneDays,
    lastRun: row?.value ?? null,
  };
}

export interface ReconcileResult {
  processed: string[];
  failed: Array<{ date: string; error: string }>;
  horizon: string;
  remaining: number;
}

/**
 * One scheduler tick. Pays the expensive full scan (incl. the external SSD
 * archive) EXACTLY ONCE, then generates every day that still needs work from
 * that single in-memory snapshot — yesterday first (forward), then newest-missing
 * days backward toward the horizon — capped at `maxDays`. A day needs work if it
 * has no complete/empty digest OR its digest is 'partial' (a source was
 * unreachable, retry it). Idempotent: a missed/interrupted run catches up next
 * time.
 */
export async function reconcile(maxDays = DEFAULT_MAX_DAYS): Promise<ReconcileResult> {
  const all = await loadDigestSessions(); // index-based: fast-root refresh + cached archive, reused for the batch
  const counted = countedFrom(all);
  const horizon = horizonFrom(counted);
  const yesterday = shiftDate(today(), -1);
  const range = dayRange(horizon, yesterday); // newest first
  const done = completeDigestDates();

  const needsWork = range.filter(date => !done.has(date)); // newest first

  // maxDays budgets *work* days, not calendar days: empty days cost no model call
  // (0 sessions → early return), so we fill them for free and only spend the
  // budget on days that actually have agent work. This makes backfill to the
  // horizon converge in far fewer runs when most historical days are empty.
  // A single day's failure (transient model error) must not sink the batch —
  // record it and move on; the day stays "needs work" and is retried next run.
  const processed: string[] = [];
  const failed: Array<{ date: string; error: string }> = [];
  let workDaysSpent = 0;
  for (const date of needsWork) {
    if (workDaysSpent >= maxDays) break;
    try {
      const digest = await generateDigest(date, { scannedSessions: all });
      processed.push(date);
      if (digest.sessionCount > 0) workDaysSpent += 1;
    } catch (error) {
      failed.push({ date, error: error instanceof Error ? error.message : String(error) });
    }
  }

  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(LAST_RUN_KEY, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));

  return { processed, failed, horizon, remaining: Math.max(0, needsWork.length - processed.length) };
}
