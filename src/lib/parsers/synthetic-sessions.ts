import { UnifiedSession } from './types';

/**
 * The daily-digest generator spawns real `claude -p` (and copilot/codex/gemini
 * equivalent) CLI calls to condense/rollup each day's work (see
 * ../daily-digest/rubric.ts + ../summarizer/runtime.ts). Those non-interactive
 * calls write a real transcript file under the CLI's own session store, so
 * they show up to every parser exactly like a normal user session — noise
 * that pollutes both the main session list and (if left uncounted) would feed
 * back into the next digest run. Detect them by their prompt's fixed opening
 * line so they can be excluded everywhere, without needing to touch/delete
 * the underlying transcript files.
 */
const SYNTHETIC_PROMPT_PREFIXES = [
  '你是 AI 编码/工作 session 的事实浓缩助手',
  '你是「每日工作价值总结」助手',
];

export function isSyntheticDigestSession(s: Pick<UnifiedSession, 'firstUserMessage'>): boolean {
  const msg = s.firstUserMessage || '';
  return SYNTHETIC_PROMPT_PREFIXES.some(prefix => msg.startsWith(prefix));
}
