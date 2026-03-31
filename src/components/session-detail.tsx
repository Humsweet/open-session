'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SessionDetail as SessionDetailType, SessionMessage } from '@/lib/parsers/types';
import { OriginBadge, ToolBadge, StatusBadge } from './tool-icon';
import { SimpleMarkdown } from './simple-markdown';
import { extractSummaryTitle, stripSummaryTitle } from '@/lib/summarizer/summary-format';
import {
  ArrowLeft, MessageSquare, Folder, Clock, Sparkles,
  CheckCircle2, Circle, Copy, ChevronDown, ChevronRight, User, Bot, Pencil, Check, X
} from 'lucide-react';

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

function getResumeCommand(session: SessionDetailType): string {
  switch (session.tool) {
    case 'claude-code':
      return `claude --resume ${session.id.replace('claude-', '')}`;
    case 'copilot-cli':
      return `# Copilot CLI session: ${session.id.replace('copilot-', '')}`;
    case 'codex-cli':
      return `codex --resume ${session.id.replace('codex-', '')}`;
    case 'gemini-cli':
      return `# Gemini CLI session: ${session.id.replace('gemini-', '')}`;
    default:
      return '';
  }
}

function MessageBubble({ message, index }: { message: SessionMessage; index: number }) {
  const [expanded, setExpanded] = useState(index < 6);
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isLong = message.content.length > 300;

  return (
    <div className="flex gap-2.5 py-2">
      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: isUser ? 'var(--accent-subtle)' : isTool ? 'var(--warning-subtle)' : 'var(--bg-tertiary)' }}>
        {isUser ? <User size={11} style={{ color: 'var(--accent)' }} /> :
         isTool ? <Sparkles size={11} style={{ color: 'var(--warning)' }} /> :
         <Bot size={11} style={{ color: 'var(--text-secondary)' }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-medium" style={{ color: isUser ? 'var(--accent)' : 'var(--text-secondary)' }}>
            {isUser ? 'You' : isTool ? 'Tool' : 'Assistant'}
          </span>
          {message.timestamp && (
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div
          className="text-[12.5px] leading-relaxed whitespace-pre-wrap break-words"
          style={{ color: 'var(--text-primary)' }}
        >
          {isLong && !expanded ? (
            <>
              {message.content.slice(0, 300)}...
              <button
                onClick={() => setExpanded(true)}
                className="ml-1 text-[11px] font-medium"
                style={{ color: 'var(--accent)' }}
              >
                Show more
              </button>
            </>
          ) : (
            message.content
          )}
          {isLong && expanded && (
            <button
              onClick={() => setExpanded(false)}
              className="ml-1 text-[11px] font-medium"
              style={{ color: 'var(--accent)' }}
            >
              Show less
            </button>
          )}
        </div>
      </div>
    </div>
  );
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

  const toggleStatus = async () => {
    if (!session) return;
    const newStatus = session.status === 'open' ? 'closed' : 'open';
    await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    setSession({ ...session, status: newStatus });
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
          setSession(current => (current ? { ...current, summary: payload.summary as string } : current));
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
    navigator.clipboard.writeText(getResumeCommand(session));
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

  const saveRename = async (overrideTitle?: string) => {
    if (!session) return;
    const nextTitle = (overrideTitle ?? renameValue).trim();

    if (!nextTitle) {
      setRenameError('Title cannot be empty');
      return;
    }

    if (nextTitle === session.title) {
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
        body: JSON.stringify({ customTitle: nextTitle }),
      });

      if (!res.ok) {
        throw new Error('Rename failed');
      }

      setSession({ ...session, title: nextTitle });
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
            onClick={toggleStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors"
            style={{
              backgroundColor: session.status === 'open' ? 'var(--success-subtle)' : 'var(--bg-tertiary)',
              borderColor: session.status === 'open' ? 'var(--success)' : 'var(--border)',
              color: session.status === 'open' ? 'var(--success)' : 'var(--text-secondary)',
            }}
          >
            {session.status === 'open' ? <CheckCircle2 size={13} /> : <Circle size={13} />}
            {session.status === 'open' ? 'Close' : 'Reopen'}
          </button>

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
                  onClick={() => saveRename(summaryTitle)}
                  disabled={savingRename || !summaryTitle || summaryTitle === session.title}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors flex-shrink-0"
                  style={{
                    backgroundColor: summaryTitle === session.title ? 'var(--bg-secondary)' : 'var(--accent-subtle)',
                    borderColor: summaryTitle === session.title ? 'var(--border)' : 'var(--accent)',
                    color: summaryTitle === session.title ? 'var(--text-tertiary)' : 'var(--accent)',
                    opacity: savingRename ? 0.6 : 1,
                  }}
                >
                  <Check size={12} />
                  {summaryTitle === session.title ? 'Applied' : 'Apply Name'}
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
        <button
          onClick={() => setShowMessages(!showMessages)}
          className="flex items-center justify-between w-full p-3.5 text-[13px] font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          <span className="flex items-center gap-1.5">
            <MessageSquare size={14} />
            Messages ({session.messages.length})
          </span>
          {showMessages ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {showMessages && (
          <div className="px-3.5 pb-3.5 divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {session.messages.length === 0 ? (
              <p className="py-4 text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                No messages to display
              </p>
            ) : (
              session.messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} index={i} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
