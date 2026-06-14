import { NextResponse } from 'next/server';
import { loadMergedSessions } from '@/lib/session-merge';

export interface ProjectSummary {
  /** Working directory — the project's stable identity across tools */
  cwd: string;
  /** Number of open sessions in this folder — the ambient "needs attention" signal */
  openCount: number;
  /** Most recent open-session activity in this project; drives recency ordering */
  lastActivity: string;
}

export async function GET() {
  try {
    const sessions = await loadMergedSessions();
    const byCwd = new Map<string, ProjectSummary>();

    for (const session of sessions) {
      // Only folders with an open session belong in the sidebar — closed/dropped
      // sessions stay reachable via search / All projects, but don't add folders.
      if (session.status !== 'open') continue;
      const cwd = session.cwd?.trim();
      if (!cwd) continue; // sessions without a cwd stay visible only under "All projects"

      const existing = byCwd.get(cwd);
      if (existing) {
        existing.openCount += 1;
        if (new Date(session.updatedAt).getTime() > new Date(existing.lastActivity).getTime()) {
          existing.lastActivity = session.updatedAt;
        }
      } else {
        byCwd.set(cwd, { cwd, openCount: 1, lastActivity: session.updatedAt });
      }
    }

    const projects = [...byCwd.values()].sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );

    return NextResponse.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
