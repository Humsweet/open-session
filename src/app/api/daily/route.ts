import { NextRequest, NextResponse } from 'next/server';
import { getDigest, listDigests } from '@/lib/daily-digest/store';
import { generateDigest, ensureDigestUsage, loadDigestSessions } from '@/lib/daily-digest/generate';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODELS = ['opus', 'sonnet', 'haiku', 'copilot'] as const;

/** GET /api/daily            → all stored digests, newest day first
 *  GET /api/daily?date=YYYY-MM-DD → that day's digest (or null)
 *  Backfills `usage` on any digest generated before token/cost tracking
 *  existed — pure cache reads + ccusage, never an LLM call, so this is free
 *  and only ever needs to run once per historical day (see ensureDigestUsage). */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (date) {
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: 'invalid date' }, { status: 400 });
    }
    const digest = getDigest(date);
    return NextResponse.json({ digest: digest ? await ensureDigestUsage(digest) : null });
  }

  const digests = listDigests();
  const scanned = digests.some(d => !d.usage) ? await loadDigestSessions() : undefined;
  const filled = await Promise.all(digests.map(d => ensureDigestUsage(d, scanned)));
  return NextResponse.json({ digests: filled });
}

/** POST /api/daily { date?, model? } → (re)generate and persist that day's
 *  digest. Long-running: makes several model calls, so callers should use a
 *  generous timeout. Manual single-day generation only. */
export async function POST(request: NextRequest) {
  let body: { date?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const date = body.date;
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) required' }, { status: 400 });
  }
  if (body.model !== undefined && !(MODELS as readonly string[]).includes(body.model)) {
    return NextResponse.json({ error: `model must be one of ${MODELS.join(', ')}` }, { status: 400 });
  }
  try {
    const digest = await generateDigest(date, { model: body.model });
    return NextResponse.json({ digest });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
