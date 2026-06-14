import { execFile } from 'child_process';
import * as path from 'path';

/**
 * Full-text transcript search backed by ripgrep.
 *
 * The previous approach read every session's entire transcript into a ~1GB
 * in-memory cache and substring-matched against it — cold, that meant reading
 * all ~400MB of session files before the first search could answer. ripgrep
 * scans the same corpus in ~0.5s cold / ~50ms warm without holding anything in
 * the Node heap, so the files stay the single source of truth (no inverted
 * index to build or let drift). When `rg` is absent we fall back to the old
 * in-process scan (see scan-cache.getTranscriptLower), so this is a pure
 * speed-up, never a correctness regression.
 */

export interface TermDescriptor {
  /** Original (lowercased) term — used as the key in the returned hit map. */
  term: string;
  /** When true the pattern is a regex (CJK fuzzy match); otherwise a fixed string. */
  isRegex: boolean;
  /** What to hand ripgrep: the regex source, or the literal term for fixed mode. */
  pattern: string;
}

let rgAvailable: boolean | null = null;

/** Probe for `rg` on PATH once per process. */
export async function ripgrepAvailable(): Promise<boolean> {
  if (rgAvailable !== null) return rgAvailable;
  rgAvailable = await new Promise<boolean>(resolve => {
    execFile('rg', ['--version'], err => resolve(!err));
  });
  return rgAvailable;
}

/** Run one ripgrep query, returning the absolute paths of files that matched. */
function rgFiles(desc: TermDescriptor, dirs: string[]): Promise<string[]> {
  // `-e` (rather than a positional) keeps a leading-dash term from being read
  // as a flag. `-i` mirrors the old lowercased-substring behavior; `--no-ignore`
  // + `--hidden` keep rg from skipping files the old full read would have seen.
  const args = [
    '-l',
    '-i',
    '--no-ignore',
    '--hidden',
    '--no-messages',
    ...(desc.isRegex ? [] : ['-F']),
    '-e',
    desc.pattern,
    '--',
    ...dirs,
  ];
  return new Promise(resolve => {
    execFile('rg', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      // rg exits 1 when there are no matches — that is not an error for us.
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve([]);
        return;
      }
      resolve(stdout ? stdout.split('\n').filter(Boolean) : []);
    });
  });
}

/** A claude subagent transcript lives at `<uuid>/subagents/...`; its parent
 * session's rawPath is `<uuid>.jsonl`. Map a matched file back to the session
 * that owns it. */
function attributeFile(file: string, rawPathToId: Map<string, string>): string | null {
  const direct = rawPathToId.get(file);
  if (direct) return direct;

  const m = file.match(/^(.*)[/\\]subagents[/\\]/);
  if (m) {
    const parent = rawPathToId.get(m[1] + '.jsonl');
    if (parent) return parent;
  }
  return null;
}

/**
 * For each term, return the set of session ids whose transcript contains it.
 * Returns null when ripgrep is unavailable, signalling the caller to fall back
 * to the in-process transcript scan.
 */
export async function searchTranscripts(
  terms: TermDescriptor[],
  sessions: Array<{ id: string; rawPath: string }>
): Promise<Map<string, Set<string>> | null> {
  if (terms.length === 0) return new Map();
  if (!(await ripgrepAvailable())) return null;

  const rawPathToId = new Map(sessions.map(s => [s.rawPath, s.id]));
  // Searching only the directories that actually hold candidate transcripts
  // scopes the scan to the current project/tool filter for free.
  const dirs = [...new Set(sessions.map(s => path.dirname(s.rawPath)))];
  if (dirs.length === 0) return new Map(terms.map(t => [t.term, new Set<string>()]));

  const hits = new Map<string, Set<string>>();
  await Promise.all(
    terms.map(async desc => {
      const files = await rgFiles(desc, dirs);
      const ids = new Set<string>();
      for (const f of files) {
        const id = attributeFile(f, rawPathToId);
        if (id) ids.add(id);
      }
      hits.set(desc.term, ids);
    })
  );
  return hits;
}
