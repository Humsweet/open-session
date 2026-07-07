import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { readPrinciples, distillPrinciples, PRINCIPLES_PATH } from '@/lib/daily-digest/principles';
import { countFeedback } from '@/lib/daily-digest/feedback-store';

const MODELS = ['opus', 'sonnet', 'haiku', 'copilot'] as const;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** md 文件 mtime（ISO），文件不存在返回 null。 */
function principlesMtime(): string | null {
  try {
    return fs.statSync(PRINCIPLES_PATH).mtime.toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch {
    return null;
  }
}

/** GET /api/daily/principles → { content, updatedAt, rawCount } */
export async function GET() {
  return NextResponse.json({
    content: readPrinciples(),
    updatedAt: principlesMtime(),
    rawCount: countFeedback(),
  });
}

/** POST /api/daily/principles { model? } → 蒸馏并写入正本，返回 { content }。 */
export async function POST(request: NextRequest) {
  let body: { model?: string } = {};
  try {
    body = await request.json();
  } catch {
    // 允许空 body：用默认模型蒸馏。
    body = {};
  }
  if (body.model !== undefined && !(MODELS as readonly string[]).includes(body.model)) {
    return NextResponse.json({ error: `model must be one of ${MODELS.join(', ')}` }, { status: 400 });
  }
  try {
    const content = await distillPrinciples(body.model, nowIso());
    return NextResponse.json({ content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
