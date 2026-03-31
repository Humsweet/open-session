import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SummaryEngine } from './spinner-verbs';

const execAsync = promisify(exec);

const SUMMARY_MODELS: Record<SummaryEngine, string> = {
  'claude-code': 'haiku',
  'copilot-cli': 'claude-haiku-4.5',
  'codex-cli': 'gpt-5-codex-mini',
  'gemini-cli': 'gemini-2.5-flash-lite',
};

export interface SummaryRuntimeStatus {
  source: 'cli';
  message: string;
}

interface RuntimeOptions {
  timeoutMs?: number;
  onStatus?: (status: SummaryRuntimeStatus) => void;
}

function quoteForShell(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function buildShellCommand(engine: Exclude<SummaryEngine, 'codex-cli'>, prompt: string): string {
  const quotedPrompt = quoteForShell(prompt);

  switch (engine) {
    case 'claude-code':
      return `claude -p ${quotedPrompt} --output-format text --model ${SUMMARY_MODELS['claude-code']}`;
    case 'copilot-cli':
      return `copilot -p ${quotedPrompt} --silent --allow-all-tools --model ${SUMMARY_MODELS['copilot-cli']}`;
    case 'gemini-cli':
      return `gemini -p ${quotedPrompt} -m ${SUMMARY_MODELS['gemini-cli']} -o text`;
    default:
      throw new Error(`Unknown engine: ${engine}`);
  }
}

function mapCodexEventToStatus(event: { type?: string; item?: { type?: string } }): string | null {
  switch (event.type) {
    case 'thread.started':
      return 'Starting';
    case 'turn.started':
      return 'Working';
    case 'item.completed':
      return event.item?.type === 'agent_message' ? 'Writing' : 'Working';
    case 'turn.completed':
      return 'Finalizing';
    default:
      return null;
  }
}

async function runCodex(prompt: string, options: RuntimeOptions): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-session-codex-'));
  const outputPath = path.join(tempDir, 'summary.txt');

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'codex',
        [
          'exec',
          '--skip-git-repo-check',
          '--json',
          '--color',
          'never',
          '-m',
          SUMMARY_MODELS['codex-cli'],
          '-o',
          outputPath,
          prompt,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        }
      );

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let settled = false;
      let lastStatus = '';
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const finish = async (error?: Error) => {
        if (settled) return;
        settled = true;

        if (timeout) clearTimeout(timeout);

        if (error) {
          reject(error);
          return;
        }

        try {
          const summary = await fs.readFile(outputPath, 'utf8');
          resolve(summary.trim());
        } catch (readError) {
          const message = readError instanceof Error ? readError.message : String(readError);
          reject(new Error(stderrBuffer.trim() || message));
        }
      };

      const emitStatus = (message: string | null) => {
        if (!message || message === lastStatus) return;
        lastStatus = message;
        options.onStatus?.({ source: 'cli', message });
      };

      const consumeStdout = () => {
        let newlineIndex = stdoutBuffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

          if (line) {
            try {
              const event = JSON.parse(line) as { type?: string; item?: { type?: string } };
              emitStatus(mapCodexEventToStatus(event));
            } catch {
              // Ignore non-JSON lines.
            }
          }

          newlineIndex = stdoutBuffer.indexOf('\n');
        }
      };

      child.stdout.on('data', chunk => {
        stdoutBuffer += chunk.toString();
        consumeStdout();
      });

      child.stderr.on('data', chunk => {
        stderrBuffer += chunk.toString();
      });

      child.on('error', error => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });

      child.on('close', code => {
        consumeStdout();

        if (code === 0) {
          finish();
          return;
        }

        const message = stderrBuffer.trim() || `codex exited with code ${code ?? 'unknown'}`;
        finish(new Error(message));
      });

      timeout = options.timeoutMs
        ? setTimeout(() => {
            child.kill('SIGTERM');
            finish(new Error(`Timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs)
        : null;
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function runShellEngine(
  engine: Exclude<SummaryEngine, 'codex-cli'>,
  prompt: string,
  options: RuntimeOptions
): Promise<string> {
  options.onStatus?.({ source: 'cli', message: 'Working' });

  const command = buildShellCommand(engine, prompt);
  const { stdout, stderr } = await execAsync(command, {
    timeout: options.timeoutMs ?? 120000,
    maxBuffer: 1024 * 1024,
  });

  if (stderr && !stdout) {
    throw new Error(stderr);
  }

  return stdout.trim();
}

export async function runSummaryEngine(
  engine: SummaryEngine,
  prompt: string,
  options: RuntimeOptions = {}
): Promise<string> {
  if (engine === 'codex-cli') {
    return runCodex(prompt, options);
  }

  return runShellEngine(engine, prompt, options);
}
