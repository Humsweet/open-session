'use client';

import { useMemo, useState } from 'react';
import { SessionOrigin, SessionStatus, ToolType } from '@/lib/parsers/types';
import { Search, ArrowUpDown, SlidersHorizontal } from 'lucide-react';

const tools: { value: ToolType | 'all'; label: string }[] = [
  { value: 'all', label: 'All tools' },
  { value: 'claude-code', label: 'Claude' },
  { value: 'copilot-cli', label: 'Copilot' },
  { value: 'codex-cli', label: 'Codex' },
  { value: 'gemini-cli', label: 'Gemini' },
];

const primaryStatuses: { value: 'open' | 'closed'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

const extendedStatuses: { value: SessionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'dropped', label: 'Dropped' },
];

const origins: { value: SessionOrigin | 'all'; label: string }[] = [
  { value: 'local', label: 'Local' },
  { value: 'slack-bot', label: 'Slack Bot' },
  { value: 'all', label: 'All' },
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
  origin: SessionOrigin | 'all';
  pinned: 'all' | 'only';
  search: string;
  sortBy: 'updatedAt' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}

interface FilterBarProps {
  onFilterChange: (filters: FilterState) => void;
}

function getSourceButtonStyle(activeOrigin: SessionOrigin | 'all', value: SessionOrigin | 'all') {
  const isActive = activeOrigin === value;

  if (!isActive) {
    return {
      backgroundColor: 'transparent',
      color: 'var(--text-tertiary)',
    };
  }

  if (value === 'slack-bot') {
    return {
      backgroundColor: 'var(--slack-subtle)',
      color: 'var(--slack)',
    };
  }

  if (value === 'local') {
    return {
      backgroundColor: 'var(--accent-subtle)',
      color: 'var(--accent)',
    };
  }

  return {
    backgroundColor: 'var(--bg-hover)',
    color: 'var(--text-primary)',
  };
}

function getToolLabel(tool: ToolType | 'all') {
  return tools.find(option => option.value === tool)?.label || 'All tools';
}

function getStatusLabel(status: SessionStatus | 'all') {
  if (status === 'all') return 'All statuses';
  if (status === 'dropped') return 'Dropped';
  return status === 'open' ? 'Open' : 'Closed';
}

function getOriginLabel(origin: SessionOrigin | 'all') {
  return origins.find(option => option.value === origin)?.label || 'All';
}

export function FilterBar({ onFilterChange }: FilterBarProps) {
  const [activeTool, setActiveTool] = useState<ToolType | 'all'>('all');
  const [activeStatus, setActiveStatus] = useState<SessionStatus | 'all'>('open');
  const [activeOrigin, setActiveOrigin] = useState<SessionOrigin | 'all'>('local');
  const [activePinned, setActivePinned] = useState<'all' | 'only'>('all');
  const [search, setSearch] = useState('');
  const [activeSort, setActiveSort] = useState('updatedAt-desc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const applyFilters = (
    next: Partial<{
      tool: ToolType | 'all';
      status: SessionStatus | 'all';
      origin: SessionOrigin | 'all';
      pinned: 'all' | 'only';
      search: string;
      sort: string;
    }>
  ) => {
    const tool = next.tool ?? activeTool;
    const status = next.status ?? activeStatus;
    const origin = next.origin ?? activeOrigin;
    const pinned = next.pinned ?? activePinned;
    const nextSearch = next.search ?? search;
    const sort = next.sort ?? activeSort;
    const [sortBy, sortOrder] = sort.split('-') as ['updatedAt' | 'createdAt', 'asc' | 'desc'];

    if (next.tool !== undefined) setActiveTool(tool);
    if (next.status !== undefined) setActiveStatus(status);
    if (next.origin !== undefined) setActiveOrigin(origin);
    if (next.pinned !== undefined) setActivePinned(pinned);
    if (next.search !== undefined) setSearch(nextSearch);
    if (next.sort !== undefined) setActiveSort(sort);

    onFilterChange({
      tool,
      status,
      origin,
      pinned,
      search: nextSearch,
      sortBy,
      sortOrder,
    });
  };

  const currentSortLabel = sortOptions.find(option => option.value === activeSort)?.label || 'Last updated';
  const activeExtraFilters = [
    activeTool !== 'all',
    activeStatus === 'all' || activeStatus === 'dropped',
    activePinned === 'only',
  ].filter(Boolean).length;

  const querySummary = useMemo(() => {
    const parts = [getStatusLabel(activeStatus), getOriginLabel(activeOrigin), currentSortLabel];
    if (activePinned === 'only') parts.push('Pinned only');
    if (activeTool !== 'all') parts.push(getToolLabel(activeTool));
    if (search.trim()) parts.push(`Search: "${search.trim()}"`);
    return parts.join(' · ');
  }, [activeOrigin, activePinned, activeStatus, activeTool, currentSortLabel, search]);

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            placeholder="Search sessions..."
            value={search}
            onChange={event => applyFilters({ search: event.target.value })}
            className="w-full pl-8 pr-3 py-2 rounded-md text-[13px] border outline-none transition-colors"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
            onFocus={event => {
              event.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onBlur={event => {
              event.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          {primaryStatuses.map(status => (
            <button
              key={status.value}
              onClick={() => applyFilters({ status: status.value })}
              className="px-3 py-1 rounded-md text-[12px] font-medium transition-colors"
              style={{
                backgroundColor: activeStatus === status.value ? 'var(--accent-subtle)' : 'transparent',
                color: activeStatus === status.value ? 'var(--accent)' : 'var(--text-tertiary)',
              }}
            >
              {status.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          {origins.map(origin => (
            <button
              key={origin.value}
              onClick={() => applyFilters({ origin: origin.value })}
              className="px-3 py-1 rounded-md text-[12px] font-medium transition-colors"
              style={getSourceButtonStyle(activeOrigin, origin.value)}
            >
              {origin.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowSortMenu(current => !current)}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-md text-[12px] font-medium border transition-colors"
              style={{
                backgroundColor: showSortMenu ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
                borderColor: showSortMenu ? 'var(--border)' : 'var(--border-subtle)',
                color: showSortMenu ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <ArrowUpDown size={13} />
              {currentSortLabel}
            </button>
            {showSortMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSortMenu(false)} />
                <div
                  className="absolute top-full right-0 mt-1 py-1 rounded-lg border z-20 min-w-[180px]"
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
                >
                  {sortOptions.map(option => (
                    <button
                      key={option.value}
                      onClick={() => {
                        applyFilters({ sort: option.value });
                        setShowSortMenu(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-[12px] transition-colors"
                      style={{
                        backgroundColor: activeSort === option.value ? 'var(--bg-hover)' : 'transparent',
                        color: activeSort === option.value ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}
                      onMouseEnter={event => {
                        event.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                      }}
                      onMouseLeave={event => {
                        if (activeSort !== option.value) {
                          event.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setShowMoreFilters(current => !current)}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-md text-[12px] font-medium border transition-colors"
            style={{
              backgroundColor: showMoreFilters ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
              borderColor: showMoreFilters || activeExtraFilters > 0 ? 'var(--accent)' : 'var(--border-subtle)',
              color: showMoreFilters || activeExtraFilters > 0 ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <SlidersHorizontal size={13} />
            More filters
            {activeExtraFilters > 0 && (
              <span
                className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold"
                style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}
              >
                {activeExtraFilters}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
        {querySummary}
      </div>

      {showMoreFilters && (
        <div
          className="rounded-lg border p-3"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex flex-wrap items-start gap-4">
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--text-tertiary)' }}>
                Status
              </p>
              <div className="flex flex-wrap gap-1">
                {extendedStatuses.map(status => (
                  <button
                    key={status.value}
                    onClick={() => applyFilters({ status: status.value })}
                    className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors"
                    style={{
                      backgroundColor: activeStatus === status.value ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                      color: activeStatus === status.value ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--text-tertiary)' }}>
                Pin
              </p>
              <div className="flex flex-wrap gap-1">
                {[
                  { value: 'all' as const, label: 'All sessions' },
                  { value: 'only' as const, label: 'Pinned only' },
                ].map(option => (
                  <button
                    key={option.value}
                    onClick={() => applyFilters({ pinned: option.value })}
                    className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors"
                    style={{
                      backgroundColor: activePinned === option.value ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                      color: activePinned === option.value ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--text-tertiary)' }}>
                Tool
              </p>
              <div className="flex flex-wrap gap-1">
                {tools.map(tool => (
                  <button
                    key={tool.value}
                    onClick={() => applyFilters({ tool: tool.value })}
                    className="px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors"
                    style={{
                      backgroundColor: activeTool === tool.value ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                      color: activeTool === tool.value ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {tool.label}
                  </button>
                ))}
              </div>
            </div>

            {activeExtraFilters > 0 && (
              <div className="ml-auto">
                <button
                  onClick={() => applyFilters({ tool: 'all', status: 'open', pinned: 'all' })}
                  className="px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  Reset extras
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
