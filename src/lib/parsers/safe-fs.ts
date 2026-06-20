import * as fs from 'fs';

/**
 * Directory reads that degrade instead of aborting the whole scan.
 *
 * A scan iterates several roots — the live local source AND, when the external
 * backup SSD is mounted, an archive root on that volume. A raw `fs.readdirSync`
 * that throws (a mounted-but-I/O-erroring SSD: just (re)mounted at login, asleep,
 * or a stale mount handle after a remount) propagates out of the parser's scan(),
 * where `scanAllSessions` swallows it to `[]` — taking down EVERY readable root,
 * including the perfectly-fine local one, and blanking the entire session list.
 *
 * The failure boundary must be the single bad directory, not the whole scan:
 * an unreadable root contributes nothing and is logged, while every other root
 * still returns its sessions. The list degrades to "local only" when the SSD is
 * flaky, never to empty. `existsSync` only catches "not mounted" — it cannot
 * catch "mounted but erroring", which is exactly the case that bit us.
 */

function warnUnreadable(dir: string, err: unknown): void {
  const code = (err as { code?: string })?.code ?? 'unknown';
  console.warn(`[parsers] skipping unreadable directory (${code}): ${dir}`);
}

/** Read directory entry names, returning [] (and logging) on any I/O error. */
export function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    warnUnreadable(dir, err);
    return [];
  }
}

/** Read directory entries with file types, returning [] (and logging) on any I/O error. */
export function safeReaddirDirents(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    warnUnreadable(dir, err);
    return [];
  }
}
