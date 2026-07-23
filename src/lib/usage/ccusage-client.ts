import { spawn } from 'child_process';
import path from 'path';

const isWindows = process.platform === 'win32';

/** ccusage is installed as a project dependency (see package.json), so its bin
 * lives at a fixed path under node_modules — no PATH resolution needed at all
 * (unlike the external claude/copilot/gemini CLIs in ../summarizer/runtime.ts,
 * which are installed elsewhere and must go through PATH). process.cwd() is the
 * repo root whenever this server runs (npm start is always launched from there —
 * see AGENTS.md), so this path is stable in dev, production, and under launchd. */
function ccusageBinPath(): string {
  return path.join(process.cwd(), 'node_modules', '.bin', isWindows ? 'ccusage.cmd' : 'ccusage');
}

function runCcusage(args: string[], timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = ccusageBinPath();
    // Same shell:true workaround as spawnCli in ../summarizer/runtime.ts: on
    // Windows the local bin is a .cmd shim, which spawn() can only run through a
    // shell. Args here are always fixed tokens, never user input, so this is safe.
    const child = isWindows
      ? spawn([bin, ...args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' '), {
          shell: true,
          windowsHide: true,
        })
      : spawn(bin, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`ccusage timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', chunk => (stdout += chunk.toString()));
    child.stderr?.on('data', chunk => (stderr += chunk.toString()));

    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `ccusage exited with code ${code ?? 'unknown'}`));
    });
  });
}

export interface CcusageSessionRow {
  agent: string;
  period: string;
  totalTokens: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  modelsUsed: string[];
}

/**
 * Pull every detected agent session's token usage + cost in one shot. Pure
 * script — reads local transcript files and does arithmetic against a pricing
 * table, never an LLM. ccusage only scans each tool's live/default session
 * directory, not our external-SSD backup archive, so the working set stays
 * small; no --since/--until narrowing needed.
 *
 * Timeout is a generous 90s (not the runCcusage 20s default): the online
 * pricing path this deliberately keeps (see the --offline note below) now
 * fetches the pricing DB per call and runs a variable ~10-31s on this machine,
 * up from the ~1s it took when this was first built. The old 20s cap was
 * calibrated for that ~1s latency and started killing every sync once online
 * pricing slowed down — leaving the session_usage cache frozen and cards
 * blank. This call is fire-and-forget and 5-min-throttled (see sync.ts), so a
 * slow background subprocess costs nothing; a too-short timeout costs all the
 * data. 90s leaves ample margin over the observed 31s worst case.
 *
 * Deliberately NOT passing `--offline`: verified it serves a stale bundled
 * pricing snapshot that computes $0 cost for a brand-new model id
 * (claude-sonnet-5 — the exact model this feature was built with) while the
 * default mode correctly prices it, at the same ~1s speed (it keeps its own
 * local pricing cache with a short refresh, not a network round-trip per
 * call). Silently-wrong-but-plausible ($0) is worse than the flag it was
 * meant to save — see AGENTS.md "优雅的失败边界".
 *
 * Only `agent === 'claude'` rows map cleanly onto our session ids: ccusage's
 * `period` for Claude Code is the session's raw UUID (the transcript's
 * filename), i.e. exactly the suffix of our `claude-<uuid>` id. codex/copilot/
 * gemini group differently in ccusage (e.g. codex by directory, not session),
 * so they're left unmapped here — moot right now since this machine has no
 * real codex/copilot/gemini session data anyway (see src/lib/usage/sync.ts).
 */
export async function fetchCcusageSessions(): Promise<CcusageSessionRow[]> {
  const stdout = await runCcusage(['session', '--json'], 90000);
  const parsed = JSON.parse(stdout) as { session?: CcusageSessionRow[] };
  return parsed.session ?? [];
}
