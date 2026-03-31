'use client';

import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Terminal, Cpu, Bot, Sparkles } from 'lucide-react';

type SummaryCli = 'claude-code' | 'copilot-cli' | 'codex-cli' | 'gemini-cli';

const cliOptions: { value: SummaryCli; label: string; icon: typeof Terminal }[] = [
  { value: 'claude-code', label: 'Claude Code (Haiku)', icon: Terminal },
  { value: 'copilot-cli', label: 'Copilot CLI (Claude Haiku 4.5)', icon: Sparkles },
  { value: 'codex-cli', label: 'Codex CLI (GPT-5-Codex-Mini)', icon: Cpu },
  { value: 'gemini-cli', label: 'Gemini CLI (Gemini 2.5 Flash-Lite)', icon: Bot },
];

export default function SettingsPage() {
  const [summaryCli, setSummaryCli] = useState<SummaryCli>('claude-code');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data.summary_cli) setSummaryCli(data.summary_cli);
      })
      .catch(console.error);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary_cli: summaryCli }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save settings:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-lg font-semibold flex items-center gap-2 mb-1" style={{ color: 'var(--text-primary)' }}>
        <SettingsIcon size={18} />
        Settings
      </h1>
      <p className="text-[13px] mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Configure Open Session preferences
      </p>

      {/* Summary CLI */}
      <div className="rounded-lg border p-4 mb-4" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
        <h2 className="text-[13px] font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          AI Summary Engine
        </h2>
        <p className="text-[12px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Choose which local CLI tool to use for generating session summaries. The selected engine is persisted in the backend, and each engine uses its low-cost summary model automatically.
        </p>

        <div className="space-y-1.5">
          {cliOptions.map(option => {
            const isSelected = summaryCli === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                onClick={() => setSummaryCli(option.value)}
                className="flex items-center gap-3 w-full p-2.5 rounded-md border text-[13px] text-left transition-colors"
                style={{
                  backgroundColor: isSelected ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border-subtle)',
                  color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                <Icon size={16} style={{ color: isSelected ? 'var(--accent)' : 'var(--text-tertiary)' }} />
                <span className="font-medium">{option.label}</span>
                {isSelected && (
                  <span className="ml-auto text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
                    Selected
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Save */}
      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition-colors"
        style={{
          backgroundColor: saved ? 'var(--success-subtle)' : 'var(--accent)',
          color: saved ? 'var(--success)' : '#fff',
          opacity: saving ? 0.6 : 1,
        }}
      >
        <Save size={14} />
        {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
