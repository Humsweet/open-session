export type SummaryEngine = 'claude-code' | 'copilot-cli' | 'codex-cli' | 'gemini-cli';

const SPINNER_VERBS: Record<SummaryEngine, string[]> = {
  'claude-code': ['Reading context', 'Reflecting', 'Condensing', 'Composing'],
  'copilot-cli': ['Scanning', 'Planning', 'Drafting', 'Wrapping up'],
  'codex-cli': ['Working'],
  'gemini-cli': ['Grounding', 'Mapping', 'Distilling', 'Shaping'],
};

export function getSpinnerVerbs(engine: SummaryEngine): string[] {
  return SPINNER_VERBS[engine];
}

export function getSummaryEngineLabel(engine: SummaryEngine): string {
  switch (engine) {
    case 'claude-code':
      return 'Claude Code';
    case 'copilot-cli':
      return 'Copilot CLI';
    case 'codex-cli':
      return 'Codex CLI';
    case 'gemini-cli':
      return 'Gemini CLI';
    default:
      return engine;
  }
}

export function usesSyntheticSpinner(engine: SummaryEngine): boolean {
  return engine !== 'codex-cli';
}
