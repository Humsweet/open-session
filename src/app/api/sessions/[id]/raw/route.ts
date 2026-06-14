import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Return a single raw JSONL entry on demand. The detail payload no longer ships
 * `rawJson` on every block (that bloated big sessions to ~9MB); instead each
 * block carries a `rawIndex` and the "{ }" inspector fetches just that line
 * here. Claude-only — other tools don't expose a raw inspector.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(_request.url);
    const line = Number(url.searchParams.get('line'));
    if (!id.startsWith('claude-') || !Number.isInteger(line) || line < 0) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const realId = id.replace('claude-', '');
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const projectsDir = path.join(home, '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    for (const folder of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const filePath = path.join(projectsDir, folder.name, `${realId}.jsonl`);
      if (!fs.existsSync(filePath)) continue;

      // Must match the parser's line numbering exactly: same split + trim filter.
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
      const raw = lines[line];
      if (raw === undefined) {
        return NextResponse.json({ error: 'Line out of range' }, { status: 404 });
      }
      return NextResponse.json({ raw });
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
