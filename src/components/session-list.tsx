'use client';

import { useState, useEffect, useCallback } from 'react';
import { SessionStatus, UnifiedSession } from '@/lib/parsers/types';
import { extractSummaryTitle } from '@/lib/summarizer/summary-format';
import { FilterBar, FilterState } from './filter-bar';
import { SessionCard } from './session-card';
import { RefreshCw, Inbox, CheckCircle2, Circle, Sparkles, X } from 'lucide-react';

export function SessionList() {
  const [sessions, setSessions] = useState<UnifiedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<FilterState>({
    tool: 'all',
    status: 'open',
    origin: 'local',
    pinned: 'all',
    search: '',
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<'summarize' | 'close' | 'apply-title' | null>(null);
  const [batchMessage, setBatchMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    concurrency: number;
    queuedCount: number;
    runningCount: number;
    successCount: number;
    failureCount: number;
    activeById: Record<string, {
      id: string;
      title: string;
      index: number;
      status: string;
      engineLabel: string;
    }>;
  } | null>(null);
  const [applyingTitleId, setApplyingTitleId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [summaryProgressById, setSummaryProgressById] = useState<Record<string, { status: string; engineLabel: string }>>({});

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.tool !== 'all') params.set('tool', filters.tool);
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.origin !== 'all') params.set('origin', filters.origin);
      if (filters.pinned !== 'all') params.set('pinned', filters.pinned);
      if (filters.search) params.set('search', filters.search);
      params.set('sortBy', filters.sortBy);
      params.set('sortOrder', filters.sortOrder);

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
        body: JSON.stringify({ customTitle: title, applySummaryTitle: true }),
      });

      if (!res.ok) {
        throw new Error('Apply name failed');
      }

      setSessions(current =>
        current.map(session => (session.id === sessionId ? { ...session, title, summaryTitleApplied: true } : session))
      );
    } catch (e) {
      console.error('Apply name failed:', e);
      setBatchMessage({ tone: 'error', text: 'Apply Name failed.' });
    } finally {
      setApplyingTitleId(null);
    }
  };

  const renameSession = async (sessionId: string, title: string) => {
    setRenamingId(sessionId);
    setBatchMessage(null);

    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customTitle: title, applySummaryTitle: false }),
      });

      if (!res.ok) {
        throw new Error('Rename failed');
      }

      setSessions(current =>
        current.map(session => (session.id === sessionId ? { ...session, title, summaryTitleApplied: false } : session))
      );
    } catch (e) {
      console.error('Rename failed:', e);
      setBatchMessage({ tone: 'error', text: 'Rename failed.' });
      throw e;
    } finally {
      setRenamingId(null);
    }
  };

  const updateStatus = async (sessionId: string, status: SessionStatus) => {
    setBatchMessage(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        throw new Error('Status update failed');
      }

      setSessions(current =>
        current.map(session => (session.id === sessionId ? { ...session, status } : session))
      );
    } catch (error) {
      console.error('Status update failed:', error);
      setBatchMessage({ tone: 'error', text: 'Status update failed.' });
    }
  };

  const updatePinned = async (sessionId: string, pinned: boolean) => {
    setBatchMessage(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      });

      if (!response.ok) {
        throw new Error('Pin update failed');
      }

      setSessions(current =>
        [...current]
          .map(session => (session.id === sessionId ? { ...session, pinned } : session))
          .filter(session => filters.pinned !== 'only' || Boolean(session.pinned))
          .sort((a, b) => {
            const pinnedDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
            if (pinnedDiff !== 0) return pinnedDiff;

            const field = filters.sortBy;
            const ta = new Date(a[field] || a.updatedAt).getTime();
            const tb = new Date(b[field] || b.updatedAt).getTime();
            return filters.sortOrder === 'asc' ? ta - tb : tb - ta;
          })
      );
    } catch (error) {
      console.error('Pin update failed:', error);
      setBatchMessage({ tone: 'error', text: 'Pin update failed.' });
    }
  };

  const summarizeSession = async (sessionId: string) => {
    setSummarizingId(sessionId);
    setBatchMessage(null);
    setSummaryProgressById(current => ({
      ...current,
      [sessionId]: {
        status: 'Starting',
        engineLabel: '',
      },
    }));

    try {
      const res = await fetch(`/api/sessions/${sessionId}/summarize`, { method: 'POST' });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Summary failed');
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
          error?: string;
          summary?: string;
          verb?: string;
          message?: string;
          engineLabel?: string;
        };

        if (event === 'status') {
          setSummaryProgressById(current => ({
            ...current,
            [sessionId]: {
              status: payload.verb || payload.message || current[sessionId]?.status || 'Working',
              engineLabel: payload.engineLabel || current[sessionId]?.engineLabel || '',
            },
          }));
          return;
        }

        if (event === 'complete' && payload.summary) {
          setSessions(current =>
            current.map(session =>
              session.id === sessionId
                ? { ...session, summary: payload.summary as string, summaryTitleApplied: false }
                : session
            )
          );
          setSummaryProgressById(current => ({
            ...current,
            [sessionId]: {
              status: 'Complete',
              engineLabel: current[sessionId]?.engineLabel || '',
            },
          }));
          return;
        }

        if (event === 'error') {
          throw new Error(payload.error || 'Summary failed');
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
    } catch (error) {
      console.error('Summary failed:', error);
      setBatchMessage({ tone: 'error', text: 'AI Summary failed.' });
    } finally {
      setSummarizingId(null);
      setSummaryProgressById(current => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
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
          concurrency?: number;
          message?: string;
          verb?: string;
          engineLabel?: string;
          error?: string;
          summary?: string;
          successCount?: number;
          failureCount?: number;
        };

        if (event === 'batch-start') {
          setBatchProgress({
            total: payload.total || selectedIds.size,
            concurrency: payload.concurrency || 1,
            queuedCount: payload.total || selectedIds.size,
            runningCount: 0,
            successCount: 0,
            failureCount: 0,
            activeById: {},
          });
          return;
        }

        if (event === 'session-start') {
          setBatchProgress(current => {
            if (!current || !payload.id) return current;
            const alreadyActive = Boolean(current.activeById[payload.id]);

            return {
              ...current,
              queuedCount: alreadyActive ? current.queuedCount : Math.max(0, current.queuedCount - 1),
              runningCount: alreadyActive ? current.runningCount : current.runningCount + 1,
              activeById: {
                ...current.activeById,
                [payload.id]: {
                  id: payload.id,
                  title: payload.title || payload.id,
                  index: payload.index || current.activeById[payload.id]?.index || 0,
                  status: current.activeById[payload.id]?.status || 'Starting',
                  engineLabel: current.activeById[payload.id]?.engineLabel || '',
                },
              },
            };
          });
          return;
        }

        if (event === 'status') {
          setBatchProgress(current => ({
            total: current?.total || payload.total || selectedIds.size,
            concurrency: current?.concurrency || 1,
            queuedCount: current && payload.id && !current.activeById[payload.id]
              ? Math.max(0, current.queuedCount - 1)
              : current?.queuedCount || 0,
            runningCount: current && payload.id && !current.activeById[payload.id]
              ? current.runningCount + 1
              : current?.runningCount || 0,
            successCount: current?.successCount || 0,
            failureCount: current?.failureCount || 0,
            activeById: {
              ...(current?.activeById || {}),
              ...(payload.id
                ? {
                    [payload.id]: {
                      id: payload.id,
                      title: current?.activeById[payload.id]?.title || payload.title || payload.id,
                      index: payload.index || current?.activeById[payload.id]?.index || 0,
                      status: payload.verb || payload.message || current?.activeById[payload.id]?.status || 'Working',
                      engineLabel: payload.engineLabel || current?.activeById[payload.id]?.engineLabel || '',
                    },
                  }
                : {}),
            },
          }));
          return;
        }

        if (event === 'session-complete') {
          if (payload.id && payload.summary) {
            setSessions(current =>
              current.map(session =>
                session.id === payload.id
                  ? { ...session, summary: payload.summary, summaryTitleApplied: false }
                  : session
              )
            );
          }
          setBatchProgress(current => {
            if (!current || !payload.id) return current;
            const nextActiveById = { ...current.activeById };
            const wasActive = Boolean(nextActiveById[payload.id]);
            delete nextActiveById[payload.id];

            return {
              ...current,
              runningCount: wasActive ? Math.max(0, current.runningCount - 1) : current.runningCount,
              successCount: current.successCount + 1,
              activeById: nextActiveById,
            };
          });
          return;
        }

        if (event === 'session-error') {
          setBatchProgress(current => {
            if (!current || !payload.id) return current;
            const nextActiveById = { ...current.activeById };
            const wasActive = Boolean(nextActiveById[payload.id]);
            delete nextActiveById[payload.id];

            return {
              ...current,
              runningCount: wasActive ? Math.max(0, current.runningCount - 1) : current.runningCount,
              failureCount: current.failureCount + 1,
              activeById: nextActiveById,
            };
          });
          return;
        }

        if (event === 'complete') {
          const successCount = payload.successCount || 0;
          const failureCount = payload.failureCount || 0;
          const message =
            failureCount > 0
              ? `${successCount} session${successCount !== 1 ? 's' : ''} summarized, ${failureCount} failed.`
              : `${successCount} session${successCount !== 1 ? 's' : ''} summarized.`;

          setBatchProgress(current =>
            current
              ? {
                  ...current,
                  queuedCount: 0,
                  runningCount: 0,
                  successCount,
                  failureCount,
                  activeById: {},
                }
              : current
          );
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
  const activeBatchSessions = batchProgress
    ? Object.values(batchProgress.activeById).sort((a, b) => a.index - b.index)
    : [];

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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {batchProgress.total} total
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {batchProgress.runningCount} running
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {batchProgress.queuedCount} queued
                </span>
                <span style={{ color: 'var(--success)' }}>
                  {batchProgress.successCount} done
                </span>
                {batchProgress.failureCount > 0 && (
                  <span style={{ color: 'var(--danger)' }}>
                    {batchProgress.failureCount} failed
                  </span>
                )}
                <span style={{ color: 'var(--text-tertiary)' }}>
                  concurrency {batchProgress.concurrency}
                </span>
              </div>

              {activeBatchSessions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {activeBatchSessions.slice(0, batchProgress.concurrency).map(item => (
                    <div
                      key={item.id}
                      className="rounded-md border px-3 py-2"
                      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
                    >
                      <p className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                        {item.index}/{batchProgress.total} · {item.title}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)' }} />
                        <span>{item.status}</span>
                        {item.engineLabel && (
                          <span
                            className="px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                          >
                            {item.engineLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              onRename={renameSession}
              onSummarize={summarizeSession}
              onStatusChange={updateStatus}
              onPinnedChange={updatePinned}
              applyingTitle={applyingTitleId === session.id}
              renaming={renamingId === session.id}
              summarizing={summarizingId === session.id}
              summaryStatus={summaryProgressById[session.id]?.status}
              summaryEngine={summaryProgressById[session.id]?.engineLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
