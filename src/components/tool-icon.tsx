'use client';

import { ToolType } from '@/lib/parsers/types';
import { Terminal, Cpu, Sparkles, Bot } from 'lucide-react';

const toolConfig: Record<ToolType, { label: string; color: string; icon: typeof Terminal }> = {
  'claude-code': { label: 'Claude', color: '#d97706', icon: Terminal },
  'copilot-cli': { label: 'Copilot', color: '#6c5ce7', icon: Sparkles },
  'codex-cli': { label: 'Codex', color: '#10b981', icon: Cpu },
  'gemini-cli': { label: 'Gemini', color: '#3b82f6', icon: Bot },
};

export function ToolIcon({ tool, size = 16 }: { tool: ToolType; size?: number }) {
  const config = toolConfig[tool];
  if (!config) return null;
  const Icon = config.icon;
  return <Icon size={size} style={{ color: config.color }} />;
}

export function ToolBadge({ tool }: { tool: ToolType }) {
  const config = toolConfig[tool];
  if (!config) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{
        backgroundColor: `${config.color}18`,
        color: config.color,
      }}
    >
      <ToolIcon tool={tool} size={12} />
      {config.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: 'open' | 'closed' }) {
  const isOpen = status === 'open';
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{
        backgroundColor: isOpen ? 'var(--success-subtle)' : 'var(--bg-tertiary)',
        color: isOpen ? 'var(--success)' : 'var(--text-tertiary)',
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isOpen ? 'var(--success)' : 'var(--text-tertiary)' }} />
      {isOpen ? 'Open' : 'Closed'}
    </span>
  );
}

export { toolConfig };
