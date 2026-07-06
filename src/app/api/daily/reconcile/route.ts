import { NextRequest, NextResponse } from 'next/server';
import { reconcile, schedulerStatus } from '@/lib/daily-digest/scheduler';

/** GET /api/daily/reconcile → scheduling status (horizon, done/total, last run). */
export async function GET() {
  try {
    return NextResponse.json(await schedulerStatus());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/daily/reconcile { maxDays? } → one scheduler tick (yesterday +
 * backfill), capped at maxDays. Invoked by scripts/daily-digest.sh. */
export async function POST(request: NextRequest) {
  let body: { maxDays?: number } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine — use default cap */
  }
  try {
    const result = await reconcile(body.maxDays);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
