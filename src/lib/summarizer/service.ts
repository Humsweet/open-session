import { SessionDetail } from '../parsers/types';
import { generateSummary } from './engine';
import { getSummaryEngineLabel, SummaryEngine } from './spinner-verbs';

type SummaryAttemptEvent =
  | { type: 'attempt-start'; engine: SummaryEngine; fallback: boolean }
  | { type: 'attempt-failed'; engine: SummaryEngine; fallback: boolean; error: string }
  | { type: 'fallback'; from: SummaryEngine; to: SummaryEngine; reason: string };

interface GenerateSummaryWithFallbackOptions {
  onEvent?: (event: SummaryAttemptEvent) => void;
  onStatus?: (status: {
    engine: SummaryEngine;
    fallback: boolean;
    source: 'cli';
    message: string;
  }) => void;
}

interface SummaryResult {
  summary: string;
  engineUsed: SummaryEngine;
  fallbackUsed: boolean;
}

function getAttemptTimeoutMs(engine: SummaryEngine, fallback: boolean): number {
  if (engine === 'codex-cli') {
    return 120000;
  }

  // Fail fast on non-Codex engines so fallback can happen quickly.
  return fallback ? 30000 : 20000;
}

const GEMINI_NOISE_PATTERNS = [
  /^Keychain initialization encountered an error:/,
  /^Require stack:$/,
  /^- .*keytar/i,
  /^Using FileKeychain fallback for secure storage\.$/,
  /^Loaded cached credentials\.$/,
];

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

function sanitizeSummaryOutput(summary: string): string {
  const cleanedLines = stripAnsi(summary)
    .split('\n')
    .filter(line => !GEMINI_NOISE_PATTERNS.some(pattern => pattern.test(line.trim())));

  return cleanedLines.join('\n').trim();
}

function validateSummaryOutput(summary: string) {
  if (!summary) {
    throw new Error('Summary output was empty');
  }

  if (!/^#\s+.+/m.test(summary)) {
    throw new Error('Summary output did not include a title heading');
  }

  if (/^这是\s*Gemini CLI 为.+项目设置的会话上下文/.test(summary)) {
    throw new Error('Summary output contained Gemini CLI context instead of a summary');
  }

  if (summary.length < 40) {
    throw new Error('Summary output was unexpectedly short');
  }

  const numberedSections = [/1[.、]/, /2[.、]/, /3[.、]/];
  const namedSections = [/一句话概述|概述/, /完成状态|已完成|进行中|可能中断/, /关键操作|要点/];
  const numberedCount = numberedSections.filter(pattern => pattern.test(summary)).length;
  const namedCount = namedSections.filter(pattern => pattern.test(summary)).length;

  if (numberedCount < 2 && namedCount < 2) {
    throw new Error('Summary output format was invalid');
  }
}

function buildAttemptOrder(primaryEngine: SummaryEngine): SummaryEngine[] {
  if (primaryEngine === 'codex-cli') {
    return ['codex-cli'];
  }

  return [primaryEngine, 'codex-cli'];
}

export async function generateSummaryWithFallback(
  session: SessionDetail,
  primaryEngine: SummaryEngine,
  options: GenerateSummaryWithFallbackOptions = {}
): Promise<SummaryResult> {
  const attemptOrder = buildAttemptOrder(primaryEngine);
  const errors: string[] = [];

  for (let index = 0; index < attemptOrder.length; index += 1) {
    const engine = attemptOrder[index];
    const fallback = index > 0;

    if (fallback) {
      options.onEvent?.({
        type: 'fallback',
        from: attemptOrder[index - 1],
        to: engine,
        reason: errors[errors.length - 1] || 'Primary engine failed',
      });
    }

    options.onEvent?.({ type: 'attempt-start', engine, fallback });

    try {
      const rawSummary = await generateSummary(session, engine, {
        timeoutMs: getAttemptTimeoutMs(engine, fallback),
        onStatus: status => {
          options.onStatus?.({
            engine,
            fallback,
            source: status.source,
            message: status.message,
          });
        },
      });
      const summary = sanitizeSummaryOutput(rawSummary);
      validateSummaryOutput(summary);

      return {
        summary,
        engineUsed: engine,
        fallbackUsed: fallback,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${getSummaryEngineLabel(engine)}: ${message}`);
      options.onEvent?.({
        type: 'attempt-failed',
        engine,
        fallback,
        error: message,
      });
    }
  }

  throw new Error(`Summary generation failed after fallback. ${errors.join(' | ')}`);
}
