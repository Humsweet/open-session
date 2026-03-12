'use client';

import Link from 'next/link';
import { UnifiedSession } from '@/lib/parsers/types';
import { ToolBadge, StatusBadge } from './tool-icon';
import { MessageSquare, Folder, Clock } from 'lucide-react';

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

export function SessionCard({ session }: { session: UnifiedSession }) {
  return (
    <Link
      href={`/sessions/${session.id}`}
      className="block p-3.5 rounded-lg border transition-all group"
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
        <StatusBadge status={session.status} />
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
  );
}
