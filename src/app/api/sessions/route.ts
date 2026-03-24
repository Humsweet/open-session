import { NextRequest, NextResponse } from 'next/server';
import { scanAllSessions, ToolType } from '@/lib/parsers';
import { getDb } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const toolFilter = searchParams.get('tool') as ToolType | null;
    const statusFilter = searchParams.get('status') as 'open' | 'closed' | 'dropped' | null;
    const search = searchParams.get('search')?.toLowerCase();
    const sortBy = searchParams.get('sortBy') || 'updatedAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    let sessions = await scanAllSessions(toolFilter || undefined);

    // Merge with persisted state from DB
    const db = getDb();
    const states = db.prepare('SELECT * FROM session_state').all() as Array<{
      session_id: string;
      status: string;
      summary: string | null;
      custom_title: string | null;
    }>;
    const stateMap = new Map(states.map(s => [s.session_id, s]));

    sessions = sessions.map(s => {
      const state = stateMap.get(s.id);
      return {
        ...s,
        status: (state?.status as 'open' | 'closed' | 'dropped') || s.status,
        summary: state?.summary || s.summary,
        title: state?.custom_title || s.title,
      };
    });

    // Apply filters
    if (statusFilter) {
      sessions = sessions.filter(s => s.status === statusFilter);
    }

    if (search) {
      sessions = sessions.filter(s =>
        s.title.toLowerCase().includes(search) ||
        s.firstUserMessage.toLowerCase().includes(search) ||
        s.cwd.toLowerCase().includes(search)
      );
    }

    // Apply sorting
    const field = sortBy as 'updatedAt' | 'createdAt';
    sessions.sort((a, b) => {
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
