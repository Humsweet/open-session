'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { SessionDetail as SessionDetailType } from '@/lib/parsers/types';
import { OriginBadge, PinBadge, ToolBadge, StatusBadge } from './tool-icon';
import { SimpleMarkdown } from './simple-markdown';
import { extractSummaryTitle, stripSummaryTitle } from '@/lib/summarizer/summary-format';
import {
  ArrowLeft, MessageSquare, Folder, Clock, Sparkles,
  Copy, ChevronDown, ChevronRight, Pencil, Check, X, CircleDot, CircleOff, Trash2, Pin, PinOff
} from 'lucide-react';
import {
  groupMessages,
  StatsBar,
  UserTextBlock,
  AssistantTextBlock,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultBlock,
  RawJsonModal,
  LegacyMessageBubble,
} from './message-blocks';

function getResumeCommand(session: SessionDetailType): string {
  switch (session.tool) {
    case 'claude-code':
      return `claude --resume ${session.id.replace('claude-', '')}`;
    case 'copilot-cli':
      return `# Copilot CLI session: ${session.id.replace('copilot-', '')}`;
    case 'codex-cli':
      return `codex resume ${session.id.replace('codex-', '')}`;
    case 'gemini-cli':
      return `# Gemini CLI session: ${session.id.replace('gemini-', '')}`;
    default:
      return '';
  }
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

export function SessionDetailView({ id }: { id: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [summaryStatus, setSummaryStatus] = useState('');
  const [summaryEngine, setSummaryEngine] = useState('');
  const [showMessages, setShowMessages] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  const [rawJsonContent, setRawJsonContent] = useState<string | null>(null);

  const summaryTitle = extractSummaryTitle(session?.summary);
  const summaryBody = stripSummaryTitle(session?.summary);

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setSession(data);
        setRenameValue(data.title ?? '');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const messages = useMemo(() => session?.messages ?? [], [session?.messages]);
  const hasRichBlocks = messages.some(message => message.blockType !== undefined);

  const groups = useMemo(() => {
    if (!hasRichBlocks) return [];
    return groupMessages(messages);
  }, [hasRichBlocks, messages]);

  const groupOffsets = useMemo(() => {
    const offsets: number[] = [];
    let offset = 0;
    for (const group of groups) {
      offsets.push(offset);
      offset += group.messages.length;
    }
    return offsets;
  }, [groups]);

  const toggleExpanded = (index: number) => {
    setExpandedIndices(current => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const expandAll = () => {
    const indices = new Set<number>();
    messages.forEach((message, index) => {
      if (
        message.blockType === 'thinking' ||
        message.blockType === 'tool_call' ||
        message.blockType === 'tool_result'
      ) {
        indices.add(index);
      }
    });
    setExpandedIndices(indices);
  };

  const collapseAll = () => {
    setExpandedIndices(new Set());
  };

  const setStatus = async (nextStatus: 'open' | 'closed' | 'dropped') => {
    if (!session) return;
    await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    setSession({ ...session, status: nextStatus });
    setShowStatusMenu(false);
  };

  const setPinned = async (nextPinned: boolean) => {
    if (!session) return;
    await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: nextPinned }),
    });
    setSession({ ...session, pinned: nextPinned });
  };

  const summarize = async () => {
    setSummarizing(true);
    setSummaryError('');
    setSummaryStatus('Preparing summary');
    setSummaryEngine('');
    try {
      const res = await fetch(`/api/sessions/${id}/summarize`, { method: 'POST' });
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

        if (payload.engineLabel) {
          setSummaryEngine(payload.engineLabel);
        }

        if (event === 'status') {
          setSummaryStatus(payload.verb || payload.message || 'Working');
          return;
        }

        if (event === 'complete') {
          if (!payload.summary) {
            throw new Error('No summary returned');
          }
          setSummaryStatus('Complete');
          setSession(current => (current ? { ...current, summary: payload.summary as string, summaryTitleApplied: false } : current));
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
    } catch (e) {
      console.error('Summary failed:', e);
      setSummaryError(e instanceof Error ? e.message : 'Summary failed');
    } finally {
      setSummarizing(false);
      setSummaryStatus('');
    }
  };

  const copyResume = () => {
    if (!session) return;
    const text = getResumeCommand(session);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    } else {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startRename = () => {
    if (!session) return;
    setRenameValue(session.title);
    setRenameError('');
    setIsRenaming(true);
  };

  const cancelRename = () => {
    if (!session) return;
    setRenameValue(session.title);
    setRenameError('');
    setIsRenaming(false);
  };

  const saveRename = async (overrideTitle?: string, applySummaryTitle = false) => {
    if (!session) return;
    const nextTitle = (overrideTitle ?? renameValue).trim();

    if (!nextTitle) {
      setRenameError('Title cannot be empty');
      return;
    }

    if (nextTitle === session.title && !applySummaryTitle) {
      setRenameError('');
      setIsRenaming(false);
      return;
    }

    setSavingRename(true);
    setRenameError('');

    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customTitle: nextTitle, applySummaryTitle }),
      });

      if (!res.ok) {
        throw new Error('Rename failed');
      }

      setSession({ ...session, title: nextTitle, summaryTitleApplied: applySummaryTitle });
      setRenameValue(nextTitle);
      setIsRenaming(false);
    } catch (e) {
      console.error('Rename failed:', e);
      setRenameError('Failed to save title');
    } finally {
      setSavingRename(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin" style={{ color: 'var(--text-tertiary)' }}>⟳</div>
      </div>
    );
  }

  if (!session) {
    return <div className="p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>Session not found</div>;
  }

  return (
    <div className="max-w-4xl">
      <button
        onClick={() => router.push('/')}
        className="flex items-center gap-1 text-[12px] font-medium mb-4 transition-colors"
        style={{ color: 'var(--text-tertiary)' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
      >
        <ArrowLeft size={14} />
        Back to sessions
      </button>

      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <input
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  autoFocus
                  className="w-full max-w-xl rounded-md border px-3 py-2 text-[13px] outline-none"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: renameError ? 'var(--danger)' : 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="Enter session title"
                />
                <button
                  onClick={() => saveRename()}
                  disabled={savingRename}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-md text-[12px] font-medium transition-colors"
                  style={{
                    backgroundColor: 'var(--accent-subtle)',
                    color: 'var(--accent)',
                    opacity: savingRename ? 0.6 : 1,
                  }}
                >
                  <Check size={13} />
                  Save
                </button>
                <button
                  onClick={cancelRename}
                  disabled={savingRename}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-md text-[12px] font-medium border transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-secondary)',
                    opacity: savingRename ? 0.6 : 1,
                  }}
                >
                  <X size={13} />
                  Cancel
                </button>
              </div>
              {renameError && (
                <p className="mt-1 text-[11px]" style={{ color: 'var(--danger)' }}>
                  {renameError}
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2 mb-2">
              <h1 className="text-base font-semibold min-w-0 break-words" style={{ color: 'var(--text-primary)' }}>
                {session.title}
              </h1>
              <button
                onClick={startRename}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors flex-shrink-0"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-secondary)',
                }}
              >
                <Pencil size={11} />
                Rename
              </button>
            </div>
          )}
          <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            <PinBadge pinned={session.pinned} />
            <ToolBadge tool={session.tool} />
            <OriginBadge origin={session.origin} />
            <StatusBadge status={session.status} />
            <span className="flex items-center gap-1">
              <MessageSquare size={12} /> {session.messageCount} messages
            </span>
            {session.cwd && (
              <span className="flex items-center gap-1 truncate max-w-64">
                <Folder size={12} /> {session.cwd}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={12} /> {timeAgo(session.updatedAt)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setPinned(!session.pinned)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
            style={{
              backgroundColor: session.pinned ? 'rgba(245, 158, 11, 0.14)' : 'var(--bg-tertiary)',
              borderColor: session.pinned ? '#f59e0b' : 'var(--border)',
              color: session.pinned ? '#f59e0b' : 'var(--text-secondary)',
            }}
          >
            {session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            {session.pinned ? 'Unpin' : 'Pin'}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(current => !current)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
              style={{
                backgroundColor:
                  session.status === 'open'
                    ? 'var(--success-subtle)'
                    : session.status === 'dropped'
                      ? 'var(--danger-subtle)'
                      : 'var(--bg-tertiary)',
                borderColor:
                  session.status === 'open'
                    ? 'var(--success)'
                    : session.status === 'dropped'
                      ? 'var(--danger)'
                      : 'var(--border)',
                color:
                  session.status === 'open'
                    ? 'var(--success)'
                    : session.status === 'dropped'
                      ? 'var(--danger)'
                      : 'var(--text-secondary)',
              }}
            >
              {session.status === 'open' ? <CircleDot size={13} /> : session.status === 'dropped' ? <Trash2 size={13} /> : <CircleOff size={13} />}
              {session.status === 'open' ? 'Open' : session.status === 'dropped' ? 'Dropped' : 'Closed'}
              <ChevronDown size={11} />
            </button>
            {showStatusMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowStatusMenu(false)} />
                <div
                  className="absolute top-full right-0 mt-1 py-1 rounded-lg border z-20 min-w-[150px]"
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}
                >
                  {[
                    { value: 'open', label: 'Open', icon: CircleDot, color: 'var(--success)' },
                    { value: 'closed', label: 'Closed', icon: CircleOff, color: 'var(--text-secondary)' },
                    { value: 'dropped', label: 'Dropped', icon: Trash2, color: 'var(--danger)' },
                  ].filter(action => action.value !== session.status).map(action => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.value}
                        onClick={() => setStatus(action.value as 'open' | 'closed' | 'dropped')}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors"
                        style={{ color: 'var(--text-secondary)' }}
                        onMouseEnter={event => {
                          event.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                          event.currentTarget.style.color = action.color;
                        }}
                        onMouseLeave={event => {
                          event.currentTarget.style.backgroundColor = 'transparent';
                          event.currentTarget.style.color = 'var(--text-secondary)';
                        }}
                      >
                        <Icon size={13} />
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <button
            onClick={copyResume}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              borderColor: 'var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            <Copy size={13} />
            {copied ? 'Copied!' : 'Resume'}
          </button>
        </div>
      </div>

      {session.origin === 'slack-bot' && (
        <div
          className="mb-5 rounded-lg border p-4"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
        >
          <h2 className="text-[13px] font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Source
          </h2>
          <div className="grid gap-2 text-[12px]">
            <div className="flex items-start justify-between gap-3">
              <span style={{ color: 'var(--text-tertiary)' }}>Origin</span>
              <span style={{ color: 'var(--text-primary)' }}>Slack Bot</span>
            </div>
            {session.agentSource && (
              <div className="flex items-start justify-between gap-3">
                <span style={{ color: 'var(--text-tertiary)' }}>Agent source</span>
                <code className="text-right break-all" style={{ color: 'var(--text-primary)' }}>
                  {session.agentSource}
                </code>
              </div>
            )}
            {session.slackThreadTs && (
              <div className="flex items-start justify-between gap-3">
                <span style={{ color: 'var(--text-tertiary)' }}>Slack thread</span>
                <code className="text-right break-all" style={{ color: 'var(--text-primary)' }}>
                  {session.slackThreadTs}
                </code>
              </div>
            )}
            {session.slackUserId && (
              <div className="flex items-start justify-between gap-3">
                <span style={{ color: 'var(--text-tertiary)' }}>Slack user</span>
                <code className="text-right break-all" style={{ color: 'var(--text-primary)' }}>
                  {session.slackUserId}
                </code>
              </div>
            )}
          </div>
        </div>
      )}

      {hasRichBlocks && <StatsBar messages={messages} />}

      <div className="mb-5 rounded-lg border p-4" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[13px] font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            <Sparkles size={14} style={{ color: 'var(--accent)' }} />
            AI Summary
          </h2>
          <button
            onClick={summarize}
            disabled={summarizing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
            style={{
              backgroundColor: 'var(--accent-subtle)',
              color: 'var(--accent)',
              opacity: summarizing ? 0.6 : 1,
            }}
          >
            {summarizing ? '⟳ Generating...' : '✨ Generate Summary'}
          </button>
        </div>
        {summarizing && (
          <div className="mb-3 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)' }} />
            <span>{summaryStatus || 'Working'}</span>
            {summaryEngine && (
              <span
                className="px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              >
                {summaryEngine}
              </span>
            )}
          </div>
        )}
        {session.summary ? (
          <div>
            {summaryTitle && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-subtle)' }}>
                <div className="min-w-0">
                  <p className="text-[11px] mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    Suggested title
                  </p>
                  <p className="text-[13px] font-medium break-words" style={{ color: 'var(--text-primary)' }}>
                    {summaryTitle}
                  </p>
                </div>
                <button
                  onClick={() => saveRename(summaryTitle, true)}
                  disabled={savingRename || !summaryTitle || session.summaryTitleApplied}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors flex-shrink-0"
                  style={{
                    backgroundColor: session.summaryTitleApplied ? 'var(--bg-secondary)' : 'var(--accent-subtle)',
                    borderColor: session.summaryTitleApplied ? 'var(--border)' : 'var(--accent)',
                    color: session.summaryTitleApplied ? 'var(--text-tertiary)' : 'var(--accent)',
                    opacity: savingRename ? 0.6 : 1,
                  }}
                >
                  <Check size={12} />
                  {session.summaryTitleApplied ? 'Applied' : 'Apply Name'}
                </button>
              </div>
            )}
            <SimpleMarkdown
              content={summaryBody || session.summary}
              className="text-[12.5px] leading-relaxed"
            />
          </div>
        ) : (
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            No summary yet. Click &quot;Generate Summary&quot; to create one using your local AI CLI.
          </p>
        )}
        {summaryError && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--danger)' }}>
            {summaryError}
          </p>
        )}
      </div>

      <div className="rounded-lg border" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between p-3.5">
          <button
            onClick={() => setShowMessages(!showMessages)}
            className="flex items-center gap-1.5 text-[13px] font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            <MessageSquare size={14} />
            Conversation ({messages.length} blocks)
            {showMessages ? <ChevronDown size={14} className="ml-1" /> : <ChevronRight size={14} className="ml-1" />}
          </button>
          {hasRichBlocks && showMessages && (
            <div className="flex gap-2">
              <button
                onClick={expandAll}
                className="px-2.5 py-1 rounded text-[11px] border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                onMouseEnter={event => {
                  event.currentTarget.style.borderColor = 'var(--text-tertiary)';
                  event.currentTarget.style.color = 'var(--text-secondary)';
                }}
                onMouseLeave={event => {
                  event.currentTarget.style.borderColor = 'var(--border)';
                  event.currentTarget.style.color = 'var(--text-tertiary)';
                }}
              >
                Expand All
              </button>
              <button
                onClick={collapseAll}
                className="px-2.5 py-1 rounded text-[11px] border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                onMouseEnter={event => {
                  event.currentTarget.style.borderColor = 'var(--text-tertiary)';
                  event.currentTarget.style.color = 'var(--text-secondary)';
                }}
                onMouseLeave={event => {
                  event.currentTarget.style.borderColor = 'var(--border)';
                  event.currentTarget.style.color = 'var(--text-tertiary)';
                }}
              >
                Collapse All
              </button>
            </div>
          )}
        </div>

        {showMessages && (
          <div className="px-3.5 pb-3.5">
            {messages.length === 0 ? (
              <p className="py-4 text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                No messages to display
              </p>
            ) : hasRichBlocks ? (
              <div className="flex flex-col gap-0.5">
                {groups.map((group, groupIndex) => {
                  const baseIndex = groupOffsets[groupIndex];

                  if (group.type === 'single') {
                    const message = group.messages[0];
                    const index = baseIndex;

                    if (message.blockType === 'thinking') {
                      return (
                        <ThinkingBlock
                          key={index}
                          message={message}
                          expanded={expandedIndices.has(index)}
                          onToggle={() => toggleExpanded(index)}
                          onRawJson={setRawJsonContent}
                        />
                      );
                    }

                    if (message.role === 'user') {
                      return <UserTextBlock key={index} message={message} />;
                    }

                    return (
                      <AssistantTextBlock
                        key={index}
                        message={message}
                        onRawJson={setRawJsonContent}
                      />
                    );
                  }

                  return (
                    <div
                      key={`tool-group-${groupIndex}`}
                      className="rounded-lg overflow-hidden border"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}
                    >
                      {group.isParallel && (
                        <div
                          className="flex items-center gap-1.5 px-3 py-1 text-[10px]"
                          style={{
                            color: 'var(--text-tertiary)',
                            background: 'var(--bg-tertiary)',
                            borderBottom: '1px solid var(--border-subtle)',
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M16 3h5v5" />
                            <path d="M8 3H3v5" />
                            <path d="M12 22v-8.3a4 4 0 00-1.172-2.828L3 3" />
                            <path d="M21 3l-7.828 7.828A4 4 0 0012 13.657V22" />
                          </svg>
                          {group.parallelCount} parallel calls
                        </div>
                      )}
                      {group.messages.map((message, messageIndex) => {
                        const index = baseIndex + messageIndex;
                        const showSeparator = messageIndex > 0;
                        return (
                          <div
                            key={index}
                            style={{ borderTop: showSeparator ? '1px solid var(--border-subtle)' : 'none' }}
                          >
                            {message.blockType === 'tool_call' ? (
                              <ToolCallBlock
                                message={message}
                                expanded={expandedIndices.has(index)}
                                onToggle={() => toggleExpanded(index)}
                                onRawJson={setRawJsonContent}
                              />
                            ) : (
                              <ToolResultBlock
                                message={message}
                                expanded={expandedIndices.has(index)}
                                onToggle={() => toggleExpanded(index)}
                                onRawJson={setRawJsonContent}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {messages.map((message, index) => (
                  <LegacyMessageBubble key={index} message={message} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {rawJsonContent && (
        <RawJsonModal json={rawJsonContent} onClose={() => setRawJsonContent(null)} />
      )}
    </div>
  );
}
