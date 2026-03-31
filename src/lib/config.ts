import os from 'os';
import path from 'path';

export interface AppConfig {
  paths: {
    claude: string;
    copilot: string;
    codex: string;
    gemini: string;
  };
  summaryCli: 'claude-code' | 'copilot-cli' | 'codex-cli' | 'gemini-cli';
}

const home = process.env.USERPROFILE || process.env.HOME || os.homedir();

export const defaultConfig: AppConfig = {
  paths: {
    claude: path.join(home, '.claude', 'projects'),
    copilot: path.join(home, '.copilot', 'session-state'),
    codex: path.join(home, '.codex', 'sessions'),
    gemini: path.join(home, '.gemini', 'antigravity', 'conversations'),
  },
  summaryCli: 'claude-code',
};
