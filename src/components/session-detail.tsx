'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SessionDetail as SessionDetailType, SessionMessage } from '@/lib/parsers/types';
import { ToolBadge, StatusBadge } from './tool-icon';
import {
  ArrowLeft, MessageSquare, Folder, Clock, Sparkles,
  CheckCircle2, Circle, Copy, ChevronDown, ChevronRight, User, Bot
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
  const [showMessages, setShowMessages] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(setSession)
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
    try {
      const res = await fetch(`/api/sessions/${id}/summarize`, { method: 'POST' });
      const data = await res.json();
      if (data.summary && session) {
        setSession({ ...session, summary: data.summary });
      }
    } catch (e) {
      console.error('Summary failed:', e);
    } finally {
      setSummarizing(false);
    }
  };

  const copyResume = () => {
    if (!session) return;
    navigator.clipboard.writeText(getResumeCommand(session));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      {/* Back */}
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

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {session.title}
          </h1>
          <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            <ToolBadge tool={session.tool} />
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

      {/* Summary Panel */}
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
        {session.summary ? (
          <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
            {session.summary}
          </p>
        ) : (
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            No summary yet. Click &quot;Generate Summary&quot; to create one using your local AI CLI.
          </p>
        )}
      </div>

      {/* Message Timeline */}
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
