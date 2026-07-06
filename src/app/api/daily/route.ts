import { NextRequest, NextResponse } from 'next/server';
import { getDigest, listDigests } from '@/lib/daily-digest/store';
import { generateDigest } from '@/lib/daily-digest/generate';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/daily            → all stored digests, newest day first
 *  GET /api/daily?date=YYYY-MM-DD → that day's digest (or null) */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (date) {
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: 'invalid date' }, { status: 400 });
    }
    return NextResponse.json({ digest: getDigest(date) });
  }
  return NextResponse.json({ digests: listDigests() });
}

/** POST /api/daily { date } → (re)generate and persist that day's digest.
 *  Long-running: makes several model calls. Callers should use a generous
 *  timeout; the scheduler invokes this one date at a time. */
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
  try {
    const digest = await generateDigest(date, { model: body.model });
    return NextResponse.json({ digest });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
