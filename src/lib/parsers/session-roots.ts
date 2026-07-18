import * as fs from 'fs';
import * as path from 'path';

/**
 * Single source of truth for *where* each tool's sessions live.
 *
 * Every tool is read from one or more "roots":
 *   · the live LOCAL source under the user's home (this machine);
 *   · — when the external backup SSD is mounted — an ARCHIVE root that mirrors
 *     the same layout under the backup volume (written by
 *     scripts/backup-sessions.sh);
 *   · — when a mac-mini mirror has been pulled — a REMOTE-HOST root that mirrors
 *     the same layout under the local mirror dir (written by
 *     scripts/mirror-mac-mini.sh), tagged with host='mac-mini'.
 * Parsers iterate these roots and reuse the exact same parsing logic regardless
 * of which root a file came from; only the `archived` flag and `host` tag differ.
 *
 * Why a registry instead of hardcoding paths in each parser: the SSD name can
 * change, and "is the backup mounted? / has the mac-mini mirror been pulled?"
 * must each be answered in exactly one place. Keeping it here means adding/moving
 * a root is a one-line edit, and the shell scripts mirror the same defaults.
 */

/** Default external backup root. MUST match OPEN_SESSION_BACKUP_ROOT's default
 * in scripts/backup-sessions.sh — change both together if the SSD is renamed. */
const DEFAULT_BACKUP_ROOT = '/Volumes/Extreme SSD/Backup/AI Agent Sessions';

/** Default mac-mini mirror root (local incremental mirror of the mac-mini's
 * sessions, laid out identically to the archive: claude/projects, codex/sessions,
 * copilot/session-state, gemini/{antigravity/conversations,tmp}).
 * MUST match OPEN_SESSION_MACMINI_MIRROR's default (MIRROR_ROOT) in
 * scripts/mirror-mac-mini.sh — change both together if the mirror path moves.
 * The mac-mini's IP / SSH host / user live only in that script's header. */
const DEFAULT_MACMINI_MIRROR_ROOT = `${homeDirRaw()}/.open-session/mirror/mac-mini`;

function homeDirRaw(): string {
  return process.env.USERPROFILE || process.env.HOME || '';
}

export function getBackupRoot(): string {
  return process.env.OPEN_SESSION_BACKUP_ROOT || DEFAULT_BACKUP_ROOT;
}

export function getMacMiniMirrorRoot(): string {
  return process.env.OPEN_SESSION_MACMINI_MIRROR || DEFAULT_MACMINI_MIRROR_ROOT;
}

function homeDir(): string {
  return homeDirRaw();
}

/** A directory to scan, tagged with whether it is the archive copy and which
 * host it belongs to. `host` unset means the local machine (this host). */
export interface SessionRoot {
  dir: string;
  archived: boolean;
  host?: string;
}

/** Which host's sessions to include. 'local' (default) = this machine only
 * (roots with no host tag, incl. this machine's backup SSD archive);
 * 'mac-mini' = only the mac-mini mirror; 'all' = every host. */
export type HostFilter = 'local' | 'mac-mini' | 'all';

/**
 * Does a root belong in a scan for the given host filter? This is the ONE place
 * host selection is decided, so a 'local' scan never even opens the mac-mini
 * mirror dir (thousands of files) — roots are picked BEFORE scanning rather than
 * sessions discarded after, keeping the default main list as fast as it was
 * before any mirror existed.
 */
export function rootMatchesHost(root: SessionRoot, host: HostFilter): boolean {
  if (host === 'all') return true;
  if (host === 'mac-mini') return root.host === 'mac-mini';
  return !root.host; // 'local'
}

/**
 * Pick the roots a scan should actually walk. `includeArchived: false` drops the
 * backup-SSD archive root — an external disk whose thousands of files make a
 * stat-every-file walk take minutes. The archive is a *static* backup, so the
 * digest indexes it once and thereafter refreshes only the fast local-disk roots
 * (live local + mac-mini mirror), reading archived sessions from the scan cache
 * instead of re-walking the SSD every run.
 */
export function selectRoots(
  roots: SessionRoot[],
  host: HostFilter,
  includeArchived = true
): SessionRoot[] {
  return roots.filter(r => rootMatchesHost(r, host) && (includeArchived || !r.archived));
}

/**
 * Is the backup volume actually mounted? For a /Volumes/<Name>/... root we
 * require the volume mount point itself to exist as a directory — never
 * auto-create it. An unmounted SSD must yield "no archive roots", never a
 * phantom empty directory that looks like an empty (data-losing) archive.
 */
function backupRootAvailable(backupRoot: string): boolean {
  if (backupRoot.startsWith('/Volumes/')) {
    const rest = backupRoot.slice('/Volumes/'.length);
    const volumeName = rest.split('/')[0];
    const volumeMount = path.join('/Volumes', volumeName);
    try {
      return fs.statSync(volumeMount).isDirectory();
    } catch {
      return false;
    }
  }
  // Non-/Volumes root (e.g. a test path): just check it exists.
  try {
    return fs.statSync(backupRoot).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Is the mac-mini mirror present? Unlike the SSD there is no mount point to
 * check — the mirror is just a local dir populated by scripts/mirror-mac-mini.sh.
 * If it has never been pulled (dir absent) we simply add no mac-mini roots, the
 * same graceful "source just isn't here" behavior as an unmounted SSD. Never
 * auto-create it.
 */
function macMiniMirrorAvailable(mirrorRoot: string): boolean {
  try {
    return fs.statSync(mirrorRoot).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Build the [local, archive?, mac-mini?] root list for a tool. The archive copy
 * (backup SSD) and the mac-mini mirror both reuse the same relative layout as
 * `archiveRelParts`, so a single set of path segments drives all three.
 * @param localRelParts  path segments under $HOME for the live source
 * @param archiveRelParts path segments under the backup / mirror roots for the copy
 */
function rootsFor(localRelParts: string[], archiveRelParts: string[]): SessionRoot[] {
  const roots: SessionRoot[] = [{ dir: path.join(homeDir(), ...localRelParts), archived: false }];

  const backupRoot = getBackupRoot();
  if (backupRootAvailable(backupRoot)) {
    const archiveDir = path.join(backupRoot, ...archiveRelParts);
    // Don't double-list if the local source somehow resolves under the backup root.
    if (archiveDir !== roots[0].dir) {
      roots.push({ dir: archiveDir, archived: true });
    }
  }

  const mirrorRoot = getMacMiniMirrorRoot();
  if (macMiniMirrorAvailable(mirrorRoot)) {
    const mirrorDir = path.join(mirrorRoot, ...archiveRelParts);
    if (!roots.some(r => r.dir === mirrorDir)) {
      // A live (non-archived) copy of the mac-mini's sessions, tagged by host so
      // it can be filtered out of the local main list by default.
      roots.push({ dir: mirrorDir, archived: false, host: 'mac-mini' });
    }
  }
  return roots;
}

export function claudeRoots(): SessionRoot[] {
  return rootsFor(['.claude', 'projects'], ['claude', 'projects']);
}

export function codexRoots(): SessionRoot[] {
  return rootsFor(['.codex', 'sessions'], ['codex', 'sessions']);
}

export function copilotRoots(): SessionRoot[] {
  return rootsFor(['.copilot', 'session-state'], ['copilot', 'session-state']);
}

export function geminiConversationRoots(): SessionRoot[] {
  return rootsFor(['.gemini', 'antigravity', 'conversations'], ['gemini', 'antigravity', 'conversations']);
}

export function geminiTmpRoots(): SessionRoot[] {
  return rootsFor(['.gemini', 'tmp'], ['gemini', 'tmp']);
}

export function grokRoots(): SessionRoot[] {
  return rootsFor(['.grok', 'sessions'], ['grok', 'sessions']);
}
