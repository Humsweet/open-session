import * as fs from 'fs';
import * as path from 'path';
import { UnifiedSession } from './types';

/**
 * In-memory caches keyed by file identity (mtimeMs + size) so repeated
 * API calls only re-parse files that actually changed. Both caches live
 * for the lifetime of the server process.
 */

interface ScanEntry {
  key: string;
  session: UnifiedSession;
}

const sessionCache = new Map<string, ScanEntry>();

function fileKey(stat: fs.Stats): string {
  return `${stat.mtimeMs}:${stat.size}`;
}

export function getCachedSession(filePath: string, stat: fs.Stats): UnifiedSession | null {
  const entry = sessionCache.get(filePath);
  if (!entry || entry.key !== fileKey(stat)) return null;
  // Shallow copy: callers spread-merge DB state into these objects
  return { ...entry.session };
}

export function setCachedSession(filePath: string, stat: fs.Stats, session: UnifiedSession): void {
  sessionCache.set(filePath, { key: fileKey(stat), session });
}

/**
 * Transcript text cache for full-text search. Stores the lowercased
 * main transcript + all subagent transcripts as one string, evicting
 * least-recently-used entries past the byte budget. Search terms are
 * already lowercased by the API layer, and lowercasing is a no-op for
 * CJK, so matching against lowercased text is always correct.
 */

// Sized to hold every transcript on this machine (~400MB as UTF-16) so warm
// searches never touch disk; LRU eviction is a safety valve, not the norm
const TRANSCRIPT_CACHE_MAX_BYTES = 1024 * 1024 * 1024;

interface TranscriptEntry {
  key: string;
  text: string;
}

const transcriptCache = new Map<string, TranscriptEntry>();
let transcriptCacheBytes = 0;

function readTranscriptRaw(rawPath: string): string {
  let text = '';
  try {
    text = fs.readFileSync(rawPath, 'utf-8');
  } catch { /* unreadable main transcript */ }
  try {
    const subagentsDir = path.join(
      path.dirname(rawPath),
      path.basename(rawPath, '.jsonl'),
      'subagents'
    );
    if (fs.existsSync(subagentsDir)) {
      for (const f of fs.readdirSync(subagentsDir, { recursive: true }) as string[]) {
        if (!f.endsWith('.jsonl')) continue;
        try {
          text += '\n' + fs.readFileSync(path.join(subagentsDir, f), 'utf-8');
        } catch { /* skip unreadable subagent file */ }
      }
    }
  } catch { /* unreadable subagent dir */ }
  return text;
}

export function getTranscriptLower(rawPath: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(rawPath);
  } catch {
    return '';
  }

  const key = fileKey(stat);
  const cached = transcriptCache.get(rawPath);
  if (cached && cached.key === key) {
    // Refresh LRU position
    transcriptCache.delete(rawPath);
    transcriptCache.set(rawPath, cached);
    return cached.text;
  }

  if (cached) {
    transcriptCacheBytes -= cached.text.length * 2;
    transcriptCache.delete(rawPath);
  }

  const text = readTranscriptRaw(rawPath).toLowerCase();
  const bytes = text.length * 2;

  if (bytes <= TRANSCRIPT_CACHE_MAX_BYTES) {
    transcriptCache.set(rawPath, { key, text });
    transcriptCacheBytes += bytes;
    for (const [evictPath, entry] of transcriptCache) {
      if (transcriptCacheBytes <= TRANSCRIPT_CACHE_MAX_BYTES) break;
      if (evictPath === rawPath) continue;
      transcriptCacheBytes -= entry.text.length * 2;
      transcriptCache.delete(evictPath);
    }
  }

  return text;
}
