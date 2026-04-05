'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SessionStatus, UnifiedSession } from '@/lib/parsers/types';
import { OriginBadge, PinBadge, ToolBadge, StatusBadge } from './tool-icon';
import { extractSummaryOverview, extractSummaryTitle } from '@/lib/summarizer/summary-format';
import { MessageSquare, Folder, Clock, MoreHorizontal, CircleDot, CircleOff, Trash2, Sparkles, Check, Pencil, X, Pin, PinOff } from 'lucide-react';

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

interface SessionCardProps {
  session: UnifiedSession;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (sessionId: string) => void;
  onApplyTitle?: (sessionId: string, title: string) => Promise<void> | void;
  onRename?: (sessionId: string, title: string) => Promise<void> | void;
  onSummarize?: (sessionId: string) => Promise<void> | void;
  onStatusChange?: (sessionId: string, status: SessionStatus) => Promise<void> | void;
  onPinnedChange?: (sessionId: string, pinned: boolean) => Promise<void> | void;
  applyingTitle?: boolean;
  renaming?: boolean;
  summarizing?: boolean;
  summaryStatus?: string;
  summaryEngine?: string;
}

export function SessionCard({
  session,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onApplyTitle,
  onRename,
  onSummarize,
  onStatusChange,
  onPinnedChange,
  applyingTitle = false,
  renaming = false,
  summarizing = false,
  summaryStatus = '',
  summaryEngine = '',
}: SessionCardProps) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title);
  const [renameError, setRenameError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const summaryTitle = extractSummaryTitle(session.summary);
  const summaryOverview = extractSummaryOverview(session.summary);
  const canApplyTitle = Boolean(summaryTitle) && !session.summaryTitleApplied;
  const cardStyle = selectionMode
    ? {
        backgroundColor: selected ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
        borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
      }
    : {
        backgroundColor: hovered ? 'var(--bg-hover)' : 'var(--bg-secondary)',
        borderColor: hovered ? 'var(--border)' : 'var(--border-subtle)',
      };

  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const statusActionsSource: Array<{
    value: SessionStatus;
    label: string;
    icon: typeof CircleDot;
    color: string;
  }> = [
    { value: 'open', label: 'Mark as Open', icon: CircleDot, color: 'var(--success)' },
    { value: 'closed', label: 'Mark as Closed', icon: CircleOff, color: 'var(--text-secondary)' },
    { value: 'dropped', label: 'Mark as Dropped', icon: Trash2, color: 'var(--danger)' },
  ];
  const statusActions = statusActionsSource.filter(action => action.value !== session.status);

  const bodyContent = (
    <>
      {session.firstUserMessage && session.firstUserMessage !== session.title && (
        <p className="text-[12px] leading-relaxed line-clamp-2 mb-3.5" style={{ color: 'var(--text-tertiary)' }}>
          {session.firstUserMessage}
        </p>
      )}

      {(summarizing || summaryStatus) && (
        <div
          className="mb-3.5 rounded-lg border px-2.5 py-2"
          style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent)' }} />
            <span>{summaryStatus || 'Working'}</span>
            {summaryEngine && (
              <span
                className="rounded px-1.5 py-0.5"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                {summaryEngine}
              </span>
            )}
          </div>
        </div>
      )}

      {session.summary && (
        <div className="mb-3.5 rounded-lg border px-2.5 py-2" style={{ backgroundColor: 'var(--accent-subtle)', borderColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' }}>
          {summaryTitle && (
            <p className="text-[12px] font-medium leading-snug line-clamp-1 mb-1" style={{ color: 'var(--text-primary)' }}>
              {summaryTitle}
            </p>
          )}
          {summaryOverview && (
            <p className="text-[12px] leading-relaxed line-clamp-1" style={{ color: 'var(--text-secondary)' }}>
              {summaryOverview}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        <PinBadge pinned={session.pinned} />
        <ToolBadge tool={session.tool} />
        <OriginBadge origin={session.origin} />
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
    </>
  );

  if (selectionMode) {
    return (
      <div
        role="button"
        tabIndex={0}
      className="block p-3.5 rounded-lg border transition-all cursor-pointer"
        style={cardStyle}
        onClick={() => onToggleSelect?.(session.id)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggleSelect?.(session.id);
          }
        }}
      >
        <div className="mb-3 flex items-start gap-3 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            readOnly
            aria-label={`Select ${session.title}`}
            className="mt-0.5 h-4 w-4 rounded border"
            style={{ accentColor: 'var(--accent)' }}
          />
          <h3 className="min-w-0 text-[13px] font-medium leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
            {session.title}
          </h3>
        </div>
        {bodyContent}
      </div>
    );
  }

  return (
    <div
      className="p-4 rounded-lg border transition-all"
      style={cardStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div ref={menuRef} className="relative mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <div>
              <div className="flex items-center gap-2">
                <input
                  value={renameValue}
                  onChange={event => setRenameValue(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      const nextTitle = renameValue.trim();
                      if (!nextTitle) {
                        setRenameError('Title cannot be empty');
                        return;
                      }
                      if (nextTitle === session.title) {
                        setIsRenaming(false);
                        return;
                      }
                      Promise.resolve(onRename?.(session.id, nextTitle))
                        .then(() => setIsRenaming(false))
                        .catch(() => undefined);
                    }
                    if (event.key === 'Escape') {
                      setRenameValue(session.title);
                      setRenameError('');
                      setIsRenaming(false);
                    }
                  }}
                  autoFocus
                  className="w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: renameError ? 'var(--danger)' : 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="Enter session title"
                />
                <button
                  onClick={() => {
                    const nextTitle = renameValue.trim();
                    if (!nextTitle) {
                      setRenameError('Title cannot be empty');
                      return;
                    }
                    if (nextTitle === session.title) {
                      setIsRenaming(false);
                      return;
                    }
                    Promise.resolve(onRename?.(session.id, nextTitle))
                      .then(() => setIsRenaming(false))
                      .catch(() => undefined);
                  }}
                  disabled={renaming}
                  className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                  style={{
                    backgroundColor: 'var(--accent-subtle)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)',
                    opacity: renaming ? 0.6 : 1,
                  }}
                  aria-label={`Save title for ${session.title}`}
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => {
                    setRenameValue(session.title);
                    setRenameError('');
                    setIsRenaming(false);
                  }}
                  disabled={renaming}
                  className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-secondary)',
                    opacity: renaming ? 0.6 : 1,
                  }}
                  aria-label={`Cancel rename for ${session.title}`}
                >
                  <X size={13} />
                </button>
              </div>
              {renameError && (
                <p className="mt-1 text-[11px]" style={{ color: 'var(--danger)' }}>
                  {renameError}
                </p>
              )}
            </div>
          ) : (
            <Link href={`/sessions/${session.id}`} className="block">
              <h3 className="text-[13px] font-medium leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                {session.title}
              </h3>
            </Link>
          )}
        </div>
        <div className={`relative shrink-0${menuOpen ? ' z-50' : ''}`}>
          <button
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(current => !current);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
            style={{
              backgroundColor: menuOpen ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
              borderColor: menuOpen ? 'var(--border)' : 'var(--border-subtle)',
              color: menuOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            aria-label={`Open actions for ${session.title}`}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div
              className="absolute top-full right-0 mt-1 py-1 rounded-lg border z-20 min-w-[180px]"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: 'var(--border)',
                boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
              }}
            >
              <button
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onPinnedChange?.(session.id, !session.pinned);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors"
                style={{ color: session.pinned ? 'var(--warning, #f59e0b)' : 'var(--text-secondary)' }}
                onMouseEnter={event => {
                  event.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                  event.currentTarget.style.color = session.pinned ? 'var(--text-secondary)' : '#f59e0b';
                }}
                onMouseLeave={event => {
                  event.currentTarget.style.backgroundColor = 'transparent';
                  event.currentTarget.style.color = session.pinned ? 'var(--warning, #f59e0b)' : 'var(--text-secondary)';
                }}
              >
                {session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                {session.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onSummarize?.(session.id);
                  setMenuOpen(false);
                }}
                disabled={summarizing}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors disabled:cursor-not-allowed"
                style={{
                  color: summarizing ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                  opacity: summarizing ? 0.7 : 1,
                }}
                onMouseEnter={event => {
                  if (!summarizing) {
                    event.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                    event.currentTarget.style.color = 'var(--accent)';
                  }
                }}
                onMouseLeave={event => {
                  event.currentTarget.style.backgroundColor = 'transparent';
                  event.currentTarget.style.color = summarizing ? 'var(--text-tertiary)' : 'var(--text-secondary)';
                }}
              >
                <Sparkles size={13} />
                {summarizing ? summaryStatus || 'Summarizing...' : 'AI Summary'}
              </button>
              <button
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (summaryTitle && canApplyTitle) {
                    void onApplyTitle?.(session.id, summaryTitle);
                  }
                  setMenuOpen(false);
                }}
                disabled={!summaryTitle || !canApplyTitle || applyingTitle}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors disabled:cursor-not-allowed"
                style={{
                  color: !summaryTitle || !canApplyTitle || applyingTitle ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                  opacity: applyingTitle ? 0.7 : 1,
                }}
                onMouseEnter={event => {
                  if (summaryTitle && canApplyTitle && !applyingTitle) {
                    event.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                    event.currentTarget.style.color = 'var(--accent)';
                  }
                }}
                onMouseLeave={event => {
                  event.currentTarget.style.backgroundColor = 'transparent';
                  event.currentTarget.style.color = !summaryTitle || !canApplyTitle || applyingTitle ? 'var(--text-tertiary)' : 'var(--text-secondary)';
                }}
              >
                <Check size={13} />
                {session.summaryTitleApplied ? 'Name Applied' : 'Apply Name'}
              </button>
              <button
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  setRenameValue(session.title);
                  setRenameError('');
                  setIsRenaming(true);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={event => {
                  event.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                  event.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={event => {
                  event.currentTarget.style.backgroundColor = 'transparent';
                  event.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                <Pencil size={13} />
                Rename
              </button>
              {statusActions.length > 0 && (
                <div
                  className="mx-2 my-1 h-px"
                  style={{ backgroundColor: 'var(--border-subtle)' }}
                />
              )}
              {statusActions.map(action => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.value}
                    onClick={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onStatusChange?.(session.id, action.value);
                      setMenuOpen(false);
                    }}
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
          )}
        </div>
      </div>
      <Link href={`/sessions/${session.id}`} className="block">
        {bodyContent}
      </Link>
    </div>
  );
}
