import * as fs from 'fs';
import * as path from 'path';

/**
 * Single source of truth for *where* each tool's sessions live.
 *
 * Every tool is read from one or more "roots": the live LOCAL source under the
 * user's home, plus — when the external backup SSD is mounted — an ARCHIVE root
 * that mirrors the same layout under the backup volume (written by
 * scripts/backup-sessions.sh). Parsers iterate these roots and reuse the exact
 * same parsing logic regardless of which root a file came from; only the
 * `archived` provenance flag differs.
 *
 * Why a registry instead of hardcoding paths in each parser: the SSD name can
 * change, and "is the backup mounted?" must be answered in exactly one place.
 * Keeping it here means adding/moving the archive root is a one-line edit, and
 * the backup script (scripts/backup-sessions.sh) mirrors the same DEFAULT_BACKUP_ROOT.
 */

/** Default external backup root. MUST match OPEN_SESSION_BACKUP_ROOT's default
 * in scripts/backup-sessions.sh — change both together if the SSD is renamed. */
const DEFAULT_BACKUP_ROOT = '/Volumes/Extreme SSD/Backup/AI Agent Sessions';

export function getBackupRoot(): string {
  return process.env.OPEN_SESSION_BACKUP_ROOT || DEFAULT_BACKUP_ROOT;
}

function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || '';
}

/** A directory to scan, tagged with whether it is the archive copy. */
export interface SessionRoot {
  dir: string;
  archived: boolean;
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
 * Build the [local, archive?] root list for a tool.
 * @param localRelParts  path segments under $HOME for the live source
 * @param archiveRelParts path segments under the backup root for the archive copy
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
