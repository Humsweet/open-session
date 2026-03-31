'use client';

import { useState, useEffect, useCallback } from 'react';
import { SessionOrigin, UnifiedSession, ToolType } from '@/lib/parsers/types';
import { extractSummaryTitle } from '@/lib/summarizer/summary-format';
import { FilterBar } from './filter-bar';
import { SessionCard } from './session-card';
import { RefreshCw, Inbox, CheckCircle2, Circle, Sparkles, X } from 'lucide-react';

export function SessionList() {
  const [sessions, setSessions] = useState<UnifiedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    tool: 'all' as ToolType | 'all',
    status: 'open' as 'open' | 'closed' | 'all',
    origin: 'local' as SessionOrigin | 'all',
    search: '',
  });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<'summarize' | 'close' | 'apply-title' | null>(null);
  const [batchMessage, setBatchMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    currentId: string;
    currentTitle: string;
    currentIndex: number;
    total: number;
    status: string;
    engineLabel: string;
  } | null>(null);
  const [applyingTitleId, setApplyingTitleId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.tool !== 'all') params.set('tool', filters.tool);
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.origin !== 'all') params.set('origin', filters.origin);
      if (filters.search) params.set('search', filters.search);
      if (filters.sortBy) params.set('sortBy', filters.sortBy);
      if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);

      const res = await fetch(`/api/sessions?${params}`);
      const data = await res.json();
      const nextSessions = data.sessions || [];
      setSessions(nextSessions);
      setTotal(data.total || 0);
      setSelectedIds(prev => {
        const visibleIds = new Set(nextSessions.map((session: UnifiedSession) => session.id));
        const nextSelected = new Set<string>();
        prev.forEach(id => {
          if (visibleIds.has(id)) nextSelected.add(id);
        });
        return nextSelected;
      });
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const selectedCount = selectedIds.size;
  const allVisibleSelected = sessions.length > 0 && sessions.every(session => selectedIds.has(session.id));

  const toggleSelectionMode = () => {
    setSelectionMode(prev => {
      if (prev) {
        setSelectedIds(new Set());
      }
      return !prev;
    });
    setBatchMessage(null);
  };

  const toggleSessionSelection = (sessionId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
    setBatchMessage(null);
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(sessions.map(session => session.id)));
    setBatchMessage(null);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBatchMessage(null);
  };

  const applyTitle = async (sessionId: string, title: string) => {
    setApplyingTitleId(sessionId);
    setBatchMessage(null);

    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customTitle: title }),
      });

      if (!res.ok) {
        throw new Error('Apply name failed');
      }

      setSessions(current =>
        current.map(session => (session.id === sessionId ? { ...session, title } : session))
      );
    } catch (e) {
      console.error('Apply name failed:', e);
      setBatchMessage({ tone: 'error', text: 'Apply Name failed.' });
    } finally {
      setApplyingTitleId(null);
    }
  };

  const runBatchSummary = async () => {
    if (selectedIds.size === 0) return;

    setBatchAction('summarize');
    setBatchMessage(null);
    setBatchProgress(null);

    try {
      const res = await fetch('/api/sessions/batch/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Batch summary failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processEventBlock = (block: string) => {
        const lines = block.split('\n');
        let event = 'message';
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }

        if (dataLines.length === 0) return;
        const payload = JSON.parse(dataLines.join('\n')) as {
          id?: string;
          title?: string;
          index?: number;
          total?: number;
          message?: string;
          verb?: string;
          engineLabel?: string;
          error?: string;
          summary?: string;
          successCount?: number;
          failureCount?: number;
        };

        if (event === 'batch-start') {
          setBatchProgress(current => current ? { ...current, total: payload.total || current.total } : current);
          return;
        }

        if (event === 'session-start') {
          setBatchProgress({
            currentId: payload.id || '',
            currentTitle: payload.title || payload.id || '',
            currentIndex: payload.index || 0,
            total: payload.total || selectedIds.size,
            status: 'Starting',
            engineLabel: '',
          });
          return;
        }

        if (event === 'status') {
          setBatchProgress(current => ({
            currentId: payload.id || current?.currentId || '',
            currentTitle: current?.currentTitle || payload.id || '',
            currentIndex: current?.currentIndex || 0,
            total: current?.total || payload.total || selectedIds.size,
            status: payload.verb || payload.message || current?.status || 'Working',
            engineLabel: payload.engineLabel || current?.engineLabel || '',
          }));
          return;
        }

        if (event === 'session-complete') {
          if (payload.id && payload.summary) {
            setSessions(current =>
              current.map(session =>
                session.id === payload.id ? { ...session, summary: payload.summary } : session
              )
            );
          }
          return;
        }

        if (event === 'session-error') {
          setBatchProgress(current =>
            current
              ? {
                  ...current,
                  currentId: payload.id || current.currentId,
                  status: payload.error || 'Failed',
                }
              : current
          );
          return;
        }

        if (event === 'complete') {
          const successCount = payload.successCount || 0;
          const failureCount = payload.failureCount || 0;
          const message =
            failureCount > 0
              ? `${successCount} session${successCount !== 1 ? 's' : ''} summarized, ${failureCount} failed.`
              : `${successCount} session${successCount !== 1 ? 's' : ''} summarized.`;

          setBatchMessage({
            tone: failureCount > 0 ? 'error' : 'success',
            text: message,
          });
          return;
        }

        if (event === 'error') {
          throw new Error(payload.error || 'Batch summary failed');
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex !== -1) {
          const block = buffer.slice(0, boundaryIndex).trim();
          buffer = buffer.slice(boundaryIndex + 2);
          if (block) {
            processEventBlock(block);
          }
          boundaryIndex = buffer.indexOf('\n\n');
        }

        if (done) break;
      }

      await fetchSessions();
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Batch summary failed:', e);
      setBatchMessage({ tone: 'error', text: 'Batch summary failed.' });
    } finally {
      setBatchAction(null);
      setBatchProgress(null);
    }
  };

  const runBatchAction = async (action: 'close' | 'apply-title') => {
    if (selectedIds.size === 0) return;

    setBatchAction(action);
    setBatchMessage(null);

    try {
      const res = await fetch('/api/sessions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ids: Array.from(selectedIds),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Batch action failed');
      }

      const actionLabel = action === 'apply-title' ? 'renamed' : 'closed';
      const message =
        data.failureCount > 0
          ? `${data.successCount} session${data.successCount !== 1 ? 's' : ''} ${actionLabel}, ${data.failureCount} failed.`
          : `${data.successCount} session${data.successCount !== 1 ? 's' : ''} ${actionLabel}.`;

      setBatchMessage({
        tone: data.failureCount > 0 ? 'error' : 'success',
        text: message,
      });

      await fetchSessions();
      setSelectedIds(new Set());
    } catch (e) {
      console.error(`Batch ${action} failed:`, e);
      setBatchMessage({
        tone: 'error',
        text: action === 'apply-title' ? 'Batch Apply Name failed.' : 'Batch close failed.',
      });
    } finally {
      setBatchAction(null);
    }
  };

  const selectedWithSummaryTitle = sessions.filter(session => {
    if (!selectedIds.has(session.id)) return false;
    const title = extractSummaryTitle(session.summary);
    return Boolean(title);
  }).length;

  const actionButtonStyle = (disabled = false, accent = false) => ({
    backgroundColor: accent ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
    borderColor: accent ? 'var(--accent)' : 'var(--border)',
    color: disabled ? 'var(--text-tertiary)' : accent ? 'var(--accent)' : 'var(--text-secondary)',
    opacity: disabled ? 0.6 : 1,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Sessions</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {total} session{total !== 1 ? 's' : ''} across all tools
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSelectionMode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
            style={actionButtonStyle(false, selectionMode)}
          >
            <CheckCircle2 size={13} />
            {selectionMode ? 'Exit Multi-select' : 'Multi-select'}
          </button>
          <button
            onClick={fetchSessions}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
            style={actionButtonStyle()}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <FilterBar onFilterChange={setFilters} />

      {selectionMode && (
        <div
          className="mb-4 p-3 rounded-lg border"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                {selectedCount} selected
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Select sessions on this page, then run batch summary or batch close.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={allVisibleSelected ? clearSelection : selectAllVisible}
                disabled={sessions.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
                style={actionButtonStyle(sessions.length === 0)}
              >
                {allVisibleSelected ? <Circle size={13} /> : <CheckCircle2 size={13} />}
                {allVisibleSelected ? 'Clear all' : 'Select all'}
              </button>
              <button
                onClick={runBatchSummary}
                disabled={selectedCount === 0 || batchAction !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
                style={actionButtonStyle(selectedCount === 0 || batchAction !== null, true)}
              >
                <Sparkles size={13} />
                {batchAction === 'summarize' ? 'Summarizing...' : 'Batch summarize'}
              </button>
              <button
                onClick={() => runBatchAction('apply-title')}
                disabled={selectedCount === 0 || selectedWithSummaryTitle === 0 || batchAction !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
                style={actionButtonStyle(selectedCount === 0 || selectedWithSummaryTitle === 0 || batchAction !== null, true)}
              >
                <CheckCircle2 size={13} />
                {batchAction === 'apply-title' ? 'Applying...' : 'Batch Apply Name'}
              </button>
              <button
                onClick={() => runBatchAction('close')}
                disabled={selectedCount === 0 || batchAction !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
                style={actionButtonStyle(selectedCount === 0 || batchAction !== null)}
              >
                <X size={13} />
                {batchAction === 'close' ? 'Closing...' : 'Batch close'}
              </button>
            </div>
          </div>

          {batchProgress && (
            <div
              className="mt-3 rounded-md border px-3 py-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-subtle)' }}
            >
              <p className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                {batchProgress.currentIndex}/{batchProgress.total} · {batchProgress.currentTitle}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)' }} />
                <span>{batchProgress.status}</span>
                {batchProgress.engineLabel && (
                  <span
                    className="px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                  >
                    {batchProgress.engineLabel}
                  </span>
                )}
              </div>
            </div>
          )}

          {batchMessage && (
            <p
              className="mt-3 text-[12px]"
              style={{ color: batchMessage.tone === 'error' ? 'var(--danger)' : 'var(--success)' }}
            >
              {batchMessage.text}
            </p>
          )}
        </div>
      )}

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
            <SessionCard
              key={session.id}
              session={session}
              selectionMode={selectionMode}
              selected={selectedIds.has(session.id)}
              onToggleSelect={toggleSessionSelection}
              onApplyTitle={applyTitle}
              applyingTitle={applyingTitleId === session.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
