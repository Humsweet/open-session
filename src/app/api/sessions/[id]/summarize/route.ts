import { NextRequest, NextResponse } from 'next/server';
import { getSessionDetail } from '@/lib/parsers';
import { generateSummary } from '@/lib/summarizer/engine';
import { getDb } from '@/lib/db/client';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const detail = await getSessionDetail(id);
    if (!detail) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get configured engine
    const db = getDb();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'summary_cli'").get() as { value: string } | undefined;
    const engine = (setting?.value || 'claude-code') as 'claude-code' | 'codex-cli' | 'gemini-cli';

    const summary = await generateSummary(detail, engine);

    // Persist summary
    db.prepare(`
      INSERT INTO session_state (session_id, status, summary, updated_at)
      VALUES (?, 'open', ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        summary = excluded.summary,
        updated_at = datetime('now')
    `).run(id, summary);

    return NextResponse.json({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
