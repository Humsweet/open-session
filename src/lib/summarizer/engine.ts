import { buildSummaryPrompt } from './prompt';
import { SessionDetail } from '../parsers/types';
import { SummaryEngine } from './spinner-verbs';
import { runSummaryEngine, SummaryRuntimeStatus } from './runtime';

export async function generateSummary(
  session: SessionDetail,
  engine: SummaryEngine = 'claude-code',
  options: { timeoutMs?: number; onStatus?: (status: SummaryRuntimeStatus) => void } = {}
): Promise<string> {
  const messagesPreview = session.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(0, 20) // Take first 20 messages for context
    .map(m => `[${m.role}]: ${m.content.slice(0, 200)}`)
    .join('\n');

  const prompt = buildSummaryPrompt({
    tool: session.tool,
    firstUserMessage: session.firstUserMessage,
    lastUserMessage: session.lastUserMessage,
    messageCount: session.messageCount,
    cwd: session.cwd,
    messagesPreview: messagesPreview.slice(0, 3000), // Cap context
  });

  try {
    return await runSummaryEngine(engine, prompt, {
      timeoutMs: options.timeoutMs,
      onStatus: options.onStatus,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Summary generation failed (${engine}): ${msg}`);
  }
}
