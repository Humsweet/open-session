'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { UnifiedSession, ToolType } from '@/lib/parsers/types';
import { ToolBadge, StatusBadge } from './tool-icon';
import { MessageSquare, Folder, Clock, MoreHorizontal, CircleDot, CircleOff, Trash2, Copy, Terminal } from 'lucide-react';

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

function getResumeCommand(session: UnifiedSession): string {
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

interface SessionCardProps {
  session: UnifiedSession;
  onStatusChange?: (sessionId: string, newStatus: string) => void;
}

export function SessionCard({ session, onStatusChange }: SessionCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [menuOpen]);

  const updateStatus = async (newStatus: string) => {
    await fetch(`/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    onStatusChange?.(session.id, newStatus);
    setMenuOpen(false);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(label);
    setTimeout(() => setCopyFeedback(null), 1500);
    setMenuOpen(false);
  };

  const statusActions = [
    { value: 'open', label: 'Mark as Open', icon: CircleDot, color: 'var(--success)' },
    { value: 'closed', label: 'Mark as Closed', icon: CircleOff, color: 'var(--text-tertiary)' },
    { value: 'dropped', label: 'Mark as Dropped', icon: Trash2, color: 'var(--danger)' },
  ].filter(a => a.value !== session.status);

  return (
    <div className="relative group">
      <Link
        href={`/sessions/${session.id}`}
        className="block p-3.5 rounded-lg border transition-all"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border-subtle)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
          e.currentTarget.style.borderColor = 'var(--border-subtle)';
        }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-[13px] font-medium leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
            {session.title}
          </h3>
        </div>

        {session.firstUserMessage && session.firstUserMessage !== session.title && (
          <p className="text-[12px] leading-relaxed line-clamp-2 mb-3" style={{ color: 'var(--text-tertiary)' }}>
            {session.firstUserMessage}
          </p>
        )}

        {session.summary && (
          <div className="mb-3 p-2 rounded text-[12px] leading-relaxed line-clamp-3" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--text-secondary)' }}>
            {session.summary}
          </div>
        )}

        <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          <ToolBadge tool={session.tool} />
          <StatusBadge status={session.status} />
          <span className="flex items-center gap-1">
            <MessageSquare size={11} />
            {session.messageCount}
          </span>
          {session.cwd && (
            <span className="flex items-center gap-1 truncate max-w-48">
              <Folder size={11} />
              {session.cwd.split(/[/\\]/).slice(-2).join('/')}
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <Clock size={11} />
            {timeAgo(session.updatedAt)}
          </span>
        </div>
      </Link>

      {/* Action Menu Trigger */}
      <div ref={menuRef} className="absolute top-3 right-3 z-10">
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); setMenuOpen(!menuOpen); }}
          className="w-6 h-6 flex items-center justify-center rounded transition-colors opacity-0 group-hover:opacity-100"
          style={{
            backgroundColor: menuOpen ? 'var(--bg-active)' : 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
          }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-active)'}
          onMouseLeave={e => {
            if (!menuOpen) e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
          }}
        >
          <MoreHorizontal size={14} />
        </button>

        {menuOpen && (
          <div
            className="absolute top-full right-0 mt-1 py-1 rounded-lg border z-30 min-w-[180px]"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border)',
              boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
            }}
          >
            {/* Status Actions */}
            {statusActions.map(a => {
              const Icon = a.icon;
              return (
                <button
                  key={a.value}
                  onClick={e => { e.preventDefault(); e.stopPropagation(); updateStatus(a.value); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                    e.currentTarget.style.color = a.color;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  <Icon size={13} />
                  {a.label}
                </button>
              );
            })}

            {/* Divider */}
            <div className="my-1 border-t" style={{ borderColor: 'var(--border-subtle)' }} />

            {/* Copy Session ID */}
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); copyToClipboard(session.id, 'ID copied!'); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <Copy size={13} />
              Copy Session ID
            </button>

            {/* Copy Resume Command */}
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); copyToClipboard(getResumeCommand(session), 'Command copied!'); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <Terminal size={13} />
              Copy Resume Command
            </button>
          </div>
        )}
      </div>

      {/* Copy Feedback Toast */}
      {copyFeedback && (
        <div
          className="absolute top-3 right-12 px-2 py-1 rounded text-[11px] font-medium z-30 animate-pulse"
          style={{ backgroundColor: 'var(--success-subtle)', color: 'var(--success)' }}
        >
          {copyFeedback}
        </div>
      )}
    </div>
  );
}
