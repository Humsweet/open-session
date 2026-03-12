'use client';

import { useState } from 'react';
import { ToolType } from '@/lib/parsers/types';
import { Search, Filter } from 'lucide-react';

const tools: { value: ToolType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'claude-code', label: 'Claude' },
  { value: 'copilot-cli', label: 'Copilot' },
  { value: 'codex-cli', label: 'Codex' },
  { value: 'gemini-cli', label: 'Gemini' },
];

const statuses = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

interface FilterBarProps {
  onFilterChange: (filters: {
    tool: ToolType | 'all';
    status: 'open' | 'closed' | 'all';
    search: string;
  }) => void;
}

export function FilterBar({ onFilterChange }: FilterBarProps) {
  const [activeTool, setActiveTool] = useState<ToolType | 'all'>('all');
  const [activeStatus, setActiveStatus] = useState<'open' | 'closed' | 'all'>('all');
  const [search, setSearch] = useState('');

  const update = (tool?: ToolType | 'all', status?: 'open' | 'closed' | 'all', q?: string) => {
    const t = tool ?? activeTool;
    const s = status ?? activeStatus;
    const sq = q ?? search;
    if (tool !== undefined) setActiveTool(t);
    if (status !== undefined) setActiveStatus(s);
    if (q !== undefined) setSearch(sq);
    onFilterChange({ tool: t, status: s, search: sq });
  };

  return (
    <div className="flex items-center gap-4 mb-4">
      {/* Tool Tabs */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
        {tools.map(t => (
          <button
            key={t.value}
            onClick={() => update(t.value)}
            className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors"
            style={{
              backgroundColor: activeTool === t.value ? 'var(--bg-hover)' : 'transparent',
              color: activeTool === t.value ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-1">
        <Filter size={14} style={{ color: 'var(--text-tertiary)' }} />
        {statuses.map(s => (
          <button
            key={s.value}
            onClick={() => update(undefined, s.value as 'open' | 'closed' | 'all')}
            className="px-2 py-1 rounded text-[12px] font-medium transition-colors"
            style={{
              backgroundColor: activeStatus === s.value ? 'var(--accent-subtle)' : 'transparent',
              color: activeStatus === s.value ? 'var(--accent)' : 'var(--text-tertiary)',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex-1 relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
        <input
          type="text"
          placeholder="Search sessions..."
          value={search}
          onChange={e => update(undefined, undefined, e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 rounded-md text-[13px] border outline-none transition-colors"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
          onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
          onBlur={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
        />
      </div>
    </div>
  );
}
