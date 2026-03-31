const SUMMARY_HELPER_PROMPT_PREFIX = '你是一个 vibe coding session 分析助手。';

export function isSummaryHelperSession(session: {
  firstUserMessage?: string;
  lastUserMessage?: string;
}): boolean {
  const first = session.firstUserMessage?.trim() || '';
  const last = session.lastUserMessage?.trim() || '';

  return [first, last].some(message =>
    message.startsWith(SUMMARY_HELPER_PROMPT_PREFIX)
  );
}
