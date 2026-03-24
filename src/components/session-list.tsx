'use client';

import { useState, useEffect, useCallback } from 'react';
import { UnifiedSession, ToolType } from '@/lib/parsers/types';
import { FilterBar, FilterState } from './filter-bar';
import { SessionCard } from './session-card';
import { RefreshCw, Inbox } from 'lucide-react';

export function SessionList() {
  const [sessions, setSessions] = useState<UnifiedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<FilterState>({
    tool: 'all',
    status: 'all',
    search: '',
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.tool !== 'all') params.set('tool', filters.tool);
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (filters.sortBy) params.set('sortBy', filters.sortBy);
      if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);

      const res = await fetch(`/api/sessions?${params}`);
      const data = await res.json();
      setSessions(data.sessions || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleStatusChange = (sessionId: string, newStatus: string) => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, status: newStatus as UnifiedSession['status'] } : s
    ));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Sessions</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {total} session{total !== 1 ? 's' : ''} across all tools
          </p>
        </div>
        <button
          onClick={fetchSessions}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderColor: 'var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <FilterBar onFilterChange={setFilters} />

      {loading && sessions.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--text-tertiary)' }}>
          <Inbox size={36} />
          <p className="text-[13px]">No sessions found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(session => (
            <SessionCard key={session.id} session={session} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}
    </div>
  );
}
