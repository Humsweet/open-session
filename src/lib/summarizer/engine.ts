import { exec } from 'child_process';
import { promisify } from 'util';
import { buildSummaryPrompt } from './prompt';
import { SessionDetail } from '../parsers/types';

const execAsync = promisify(exec);

type SummaryEngine = 'claude-code' | 'codex-cli' | 'gemini-cli';

function escapeForShell(text: string): string {
  // For Windows, use double quotes and escape internal double quotes
  return text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function buildCommand(engine: SummaryEngine, prompt: string): string {
  const escaped = escapeForShell(prompt);
  switch (engine) {
    case 'claude-code':
      return `claude -p "${escaped}" --output-format text`;
    case 'codex-cli':
      return `echo "${escaped}" | codex -q`;
    case 'gemini-cli':
      return `echo "${escaped}" | gemini`;
    default:
      throw new Error(`Unknown engine: ${engine}`);
  }
}

export async function generateSummary(
  session: SessionDetail,
  engine: SummaryEngine = 'claude-code'
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

  const command = buildCommand(engine, prompt);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 120000, // 2 min timeout
      maxBuffer: 1024 * 1024,
    });
    if (stderr && !stdout) throw new Error(stderr);
    return stdout.trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Summary generation failed (${engine}): ${msg}`);
  }
}
