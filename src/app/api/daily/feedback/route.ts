import { NextRequest, NextResponse } from 'next/server';
import { saveItemFeedback, getFeedbackForDate, ItemFeedback } from '@/lib/daily-digest/feedback-store';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIERS = ['S', 'A', 'B'] as const;
const LINES = ['career', 'personal', 'consumption'] as const;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** GET /api/daily/feedback?date=YYYY-MM-DD → { feedback: Record<sessionId, ItemFeedback> } */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date');
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) required' }, { status: 400 });
  }
  return NextResponse.json({ feedback: getFeedbackForDate(date) });
}

/** POST /api/daily/feedback → upsert (or clear) one item's feedback, returns {ok:true}. */
export async function POST(request: NextRequest) {
  let body: {
    date?: string;
    sessionId?: string;
    itemTitle?: string;
    aiTier?: string;
    aiLine?: string;
    aiCategory?: string;
    comment?: string;
    suggestedTier?: string | null;
    suggestedLine?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  if (!body.date || !DATE_RE.test(body.date)) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) required' }, { status: 400 });
  }
  if (!body.sessionId || typeof body.sessionId !== 'string') {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }
  if (body.suggestedTier != null && !(TIERS as readonly string[]).includes(body.suggestedTier)) {
    return NextResponse.json({ error: `suggestedTier must be one of ${TIERS.join(', ')} or null` }, { status: 400 });
  }
  if (body.suggestedLine != null && !(LINES as readonly string[]).includes(body.suggestedLine)) {
    return NextResponse.json({ error: `suggestedLine must be one of ${LINES.join(', ')} or null` }, { status: 400 });
  }

  const fb: ItemFeedback = {
    sessionId: body.sessionId,
    date: body.date,
    itemTitle: body.itemTitle ?? '',
    aiTier: body.aiTier ?? '',
    aiLine: body.aiLine ?? '',
    aiCategory: body.aiCategory ?? '',
    comment: body.comment ?? '',
    suggestedTier: body.suggestedTier ?? null,
    suggestedLine: body.suggestedLine ?? null,
    updatedAt: nowIso(),
  };
  saveItemFeedback(fb);
  return NextResponse.json({ ok: true });
}
