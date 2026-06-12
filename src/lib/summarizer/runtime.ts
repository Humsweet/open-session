import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { SummaryEngine } from './spinner-verbs';

const SUMMARY_MODELS: Record<SummaryEngine, string> = {
  'claude-code': 'haiku',
  'copilot-cli': 'claude-haiku-4.5',
  'codex-cli': 'gpt-5.4',
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

const isWindows = process.platform === 'win32';

// The prompt is always delivered via stdin, never on the command line, so the
// argv only ever contains fixed tokens (flags, model names, temp paths). This
// sidesteps shell quoting entirely — POSIX quoting breaks cmd.exe and vice
// versa, and cmd.exe cannot carry multi-line arguments at all.
function spawnCli(command: string, args: string[]): ChildProcess {
  // npm-installed CLIs (claude, gemini, codex) are .cmd shims on Windows,
  // which spawn() can only execute through a shell. Building the command line
  // ourselves is safe here because args are fixed tokens or temp paths.
  if (isWindows) {
    const commandLine = [command, ...args.map(a => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
    return spawn(commandLine, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    });
  }

  return spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
    windowsHide: true,
  });
}

// With shell:true on Windows, child.pid is cmd.exe — kill the whole tree so
// the actual CLI process doesn't outlive a timeout.
function killCliTree(child: ChildProcess): void {
  if (isWindows && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

interface StdinCliInvocation {
  command: string;
  args: string[];
}

function buildCliInvocation(engine: Exclude<SummaryEngine, 'codex-cli'>): StdinCliInvocation {
  switch (engine) {
    case 'claude-code':
      return {
        command: 'claude',
        args: ['-p', '--output-format', 'text', '--model', SUMMARY_MODELS['claude-code']],
      };
    case 'copilot-cli':
      return {
        command: 'copilot',
        args: ['--silent', '--allow-all-tools', '--model', SUMMARY_MODELS['copilot-cli']],
      };
    case 'gemini-cli':
      return {
        command: 'gemini',
        args: ['-m', SUMMARY_MODELS['gemini-cli'], '-o', 'text'],
      };
    default:
      throw new Error(`Unknown engine: ${engine}`);
  }
}

function runCliWithStdin(
  command: string,
  args: string[],
  prompt: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnCli(command, args);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killCliTree(child);
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });

    child.on('close', code => {
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`));
    });

    // EPIPE if the process exits before consuming stdin — 'close' reports the real error.
    child.stdin?.on('error', () => {});
    child.stdin?.end(prompt);
  });
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
      // '-' makes codex exec read the prompt from stdin.
      const child = spawnCli('codex', [
        'exec',
        '--skip-git-repo-check',
        '--json',
        '--color',
        'never',
        '-m',
        SUMMARY_MODELS['codex-cli'],
        '-o',
        outputPath,
        '-',
      ]);

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

      child.stdout?.on('data', chunk => {
        stdoutBuffer += chunk.toString();
        consumeStdout();
      });

      child.stderr?.on('data', chunk => {
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

      child.stdin?.on('error', () => {});
      child.stdin?.end(prompt);

      timeout = options.timeoutMs
        ? setTimeout(() => {
            killCliTree(child);
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

  const { command, args } = buildCliInvocation(engine);
  const { stdout, stderr } = await runCliWithStdin(command, args, prompt, options.timeoutMs ?? 120000);

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
