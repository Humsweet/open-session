'use client';

import { useState } from 'react';
import Link from 'next/link';
import { UnifiedSession } from '@/lib/parsers/types';
import { OriginBadge, ToolBadge, StatusBadge } from './tool-icon';
import { extractSummaryOverview, extractSummaryTitle } from '@/lib/summarizer/summary-format';
import { MessageSquare, Folder, Clock, Check } from 'lucide-react';

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
  applyingTitle?: boolean;
}

export function SessionCard({
  session,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onApplyTitle,
  applyingTitle = false,
}: SessionCardProps) {
  const [hovered, setHovered] = useState(false);
  const summaryTitle = extractSummaryTitle(session.summary);
  const summaryOverview = extractSummaryOverview(session.summary);
  const canApplyTitle = Boolean(summaryTitle) && summaryTitle !== session.title;
  const cardStyle = selectionMode
    ? {
        backgroundColor: selected ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
        borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
      }
    : {
        backgroundColor: hovered ? 'var(--bg-hover)' : 'var(--bg-secondary)',
        borderColor: hovered ? 'var(--border)' : 'var(--border-subtle)',
      };

  const content = (
    <>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {selectionMode && (
            <input
              type="checkbox"
              checked={selected}
              readOnly
              aria-label={`Select ${session.title}`}
              className="mt-0.5 h-4 w-4 rounded border"
              style={{ accentColor: 'var(--accent)' }}
            />
          )}
          <h3 className="text-[13px] font-medium leading-snug line-clamp-2 min-w-0" style={{ color: 'var(--text-primary)' }}>
            {session.title}
          </h3>
        </div>
        <StatusBadge status={session.status} />
      </div>

      {session.firstUserMessage && session.firstUserMessage !== session.title && (
        <p className="text-[12px] leading-relaxed line-clamp-2 mb-3" style={{ color: 'var(--text-tertiary)' }}>
          {session.firstUserMessage}
        </p>
      )}

      {session.summary && (
        <div className="mb-3 p-2 rounded" style={{ backgroundColor: 'var(--accent-subtle)' }}>
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
        <ToolBadge tool={session.tool} />
        <OriginBadge origin={session.origin} />
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
        {content}
      </div>
    );
  }

  return (
    <div
      className="p-3.5 rounded-lg border transition-all"
      style={cardStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link href={`/sessions/${session.id}`} className="block">
        {content}
      </Link>
      {summaryTitle && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              if (summaryTitle && canApplyTitle) {
                void onApplyTitle?.(session.id, summaryTitle);
              }
            }}
            disabled={!canApplyTitle || applyingTitle}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors"
            style={{
              backgroundColor: canApplyTitle ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
              borderColor: canApplyTitle ? 'var(--accent)' : 'var(--border)',
              color: canApplyTitle ? 'var(--accent)' : 'var(--text-tertiary)',
              opacity: applyingTitle ? 0.6 : 1,
            }}
          >
            <Check size={12} />
            {canApplyTitle ? 'Apply Name' : 'Applied'}
          </button>
        </div>
      )}
    </div>
  );
}
