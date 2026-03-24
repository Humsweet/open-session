'use client';

import { useState } from 'react';
import { ToolType, SessionStatus } from '@/lib/parsers/types';
import { Search, Filter, ArrowUpDown } from 'lucide-react';

const tools: { value: ToolType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'claude-code', label: 'Claude' },
  { value: 'copilot-cli', label: 'Copilot' },
  { value: 'codex-cli', label: 'Codex' },
  { value: 'gemini-cli', label: 'Gemini' },
];

const statuses: { value: SessionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'dropped', label: 'Dropped' },
];

const sortOptions = [
  { value: 'updatedAt-desc', label: 'Last updated' },
  { value: 'updatedAt-asc', label: 'Oldest updated' },
  { value: 'createdAt-desc', label: 'Newest created' },
  { value: 'createdAt-asc', label: 'Oldest created' },
];

export interface FilterState {
  tool: ToolType | 'all';
  status: SessionStatus | 'all';
  search: string;
  sortBy: string;
  sortOrder: string;
}

interface FilterBarProps {
  onFilterChange: (filters: FilterState) => void;
}

export function FilterBar({ onFilterChange }: FilterBarProps) {
  const [activeTool, setActiveTool] = useState<ToolType | 'all'>('all');
  const [activeStatus, setActiveStatus] = useState<SessionStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [activeSort, setActiveSort] = useState('updatedAt-desc');
  const [showSortMenu, setShowSortMenu] = useState(false);

  const update = (
    tool?: ToolType | 'all',
    status?: SessionStatus | 'all',
    q?: string,
    sort?: string,
  ) => {
    const t = tool ?? activeTool;
    const s = status ?? activeStatus;
    const sq = q ?? search;
    const so = sort ?? activeSort;
    if (tool !== undefined) setActiveTool(t);
    if (status !== undefined) setActiveStatus(s);
    if (q !== undefined) setSearch(sq);
    if (sort !== undefined) setActiveSort(so);
    const [sortBy, sortOrder] = so.split('-');
    onFilterChange({ tool: t, status: s, search: sq, sortBy, sortOrder });
  };

  const currentSortLabel = sortOptions.find(o => o.value === activeSort)?.label || 'Last updated';

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
            onClick={() => update(undefined, s.value)}
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

      {/* Sort */}
      <div className="relative">
        <button
          onClick={() => setShowSortMenu(!showSortMenu)}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[12px] font-medium transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--text-tertiary)',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
          onMouseLeave={e => {
            if (!showSortMenu) e.currentTarget.style.color = 'var(--text-tertiary)';
          }}
        >
          <ArrowUpDown size={13} />
          {currentSortLabel}
        </button>
        {showSortMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowSortMenu(false)} />
            <div
              className="absolute top-full left-0 mt-1 py-1 rounded-lg border z-20 min-w-[160px]"
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
            >
              {sortOptions.map(o => (
                <button
                  key={o.value}
                  onClick={() => { update(undefined, undefined, undefined, o.value); setShowSortMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] transition-colors"
                  style={{
                    backgroundColor: activeSort === o.value ? 'var(--bg-hover)' : 'transparent',
                    color: activeSort === o.value ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                  onMouseLeave={e => {
                    if (activeSort !== o.value) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
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
