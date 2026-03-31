'use client';

import { useState } from 'react';
import { SessionMessage } from '@/lib/parsers/types';
import { User, Bot, Copy, X, Code2 } from 'lucide-react';

// ============ Types ============

export interface MessageGroup {
  type: 'single' | 'tool_group';
  messages: SessionMessage[];
  isParallel?: boolean;
  parallelCount?: number;
}

// ============ Tool Colors ============

const TOOL_COLORS: Record<string, { color: string; bg: string }> = {
  Read:        { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  Edit:        { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  Write:       { color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  Bash:        { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  Grep:        { color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
  Glob:        { color: '#ec4899', bg: 'rgba(236,72,153,0.12)' },
  Agent:       { color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  ToolSearch:  { color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  TaskCreate:  { color: '#14b8a6', bg: 'rgba(20,184,166,0.12)' },
  TaskUpdate:  { color: '#14b8a6', bg: 'rgba(20,184,166,0.12)' },
  Skill:       { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
};

function getToolStyle(name: string) {
  return TOOL_COLORS[name] || { color: '#6b7280', bg: 'rgba(107,114,128,0.12)' };
}

// ============ Helpers ============

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash': return String(input.command || '');
    case 'Read': return String(input.file_path || '');
    case 'Edit': return String(input.file_path || '');
    case 'Write': return String(input.file_path || '');
    case 'Grep': return `${input.pattern || ''} ${input.path ? 'in ' + input.path : ''}`.trim();
    case 'Glob': return String(input.pattern || '');
    case 'Agent': return `${input.subagent_type ? input.subagent_type + ': ' : ''}${input.description || ''}`;
    case 'ToolSearch': return String(input.query || '');
    case 'TaskCreate': return String(input.description || input.subject || '');
    case 'TaskUpdate': return `${input.id || input.taskId || ''} → ${input.status || ''}`;
    case 'Skill': return String(input.skill || '');
    default: return JSON.stringify(input).slice(0, 120);
  }
}

function highlightJson(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/"([^"\\]*(\\.[^"\\]*)*)"\s*:/g, '<span style="color:#3b82f6">"$1"</span>:')
    .replace(/:\s*"([^"\\]*(\\.[^"\\]*)*)"/g, ': <span style="color:#00c853">"$1"</span>')
    .replace(/:\s*(true|false)\b/g, ': <span style="color:#ff9100">$1</span>')
    .replace(/:\s*(\d+(\.\d+)?)\b/g, ': <span style="color:#ff9100">$1</span>')
    .replace(/:\s*(null)\b/g, ': <span style="color:var(--text-tertiary)">$1</span>');
}

function renderMarkdown(text: string): string {
  let html = escapeHtml(text);
  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
    '<pre style="background:var(--bg-active);padding:10px 12px;border-radius:6px;overflow-x:auto;margin:8px 0;font-size:12px;line-height:1.5;font-family:var(--font-mono),monospace"><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g,
    '<code style="background:var(--bg-active);padding:1px 5px;border-radius:3px;font-size:12px;font-family:var(--font-mono),monospace">$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>');
  // h3
  html = html.replace(/^### (.+)$/gm, '<div style="font-size:13px;font-weight:600;margin:12px 0 6px;color:var(--text-primary)">$1</div>');
  // h2
  html = html.replace(/^## (.+)$/gm, '<div style="font-size:15px;font-weight:600;margin:16px 0 8px;color:var(--text-primary)">$1</div>');
  // HR
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border-subtle);margin:12px 0">');
  // List items
  html = html.replace(/^- (.+)$/gm, '<div style="padding-left:16px">\u2022 $1</div>');
  // Newlines
  html = html.replace(/\n/g, '<br>');
  // Fix: remove <br> inside pre blocks
  html = html.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/g, (match) => {
    return match.replace(/<br>/g, '\n');
  });
  return html;
}

// ============ Grouping ============

export function groupMessages(messages: SessionMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let toolBuffer: SessionMessage[] = [];

  const flushTools = () => {
    if (toolBuffer.length === 0) return;
    let leadingCalls = 0;
    for (const m of toolBuffer) {
      if (m.blockType === 'tool_call') leadingCalls++;
      else break;
    }
    groups.push({
      type: 'tool_group',
      messages: [...toolBuffer],
      isParallel: leadingCalls > 1,
      parallelCount: leadingCalls > 1 ? leadingCalls : undefined,
    });
    toolBuffer = [];
  };

  for (const msg of messages) {
    if (msg.blockType === 'tool_call' || msg.blockType === 'tool_result') {
      toolBuffer.push(msg);
    } else {
      flushTools();
      groups.push({ type: 'single', messages: [msg] });
    }
  }
  flushTools();

  return groups;
}

// ============ Stats Bar ============

export function StatsBar({ messages }: { messages: SessionMessage[] }) {
  const thinking = messages.filter(m => m.blockType === 'thinking').length;
  const text = messages.filter(m => m.blockType === 'text' && m.role === 'assistant').length;
  const toolCalls = messages.filter(m => m.blockType === 'tool_call').length;
  const userMsgs = messages.filter(m => m.blockType === 'text' && m.role === 'user').length;
  const errors = messages.filter(m => m.isError).length;

  return (
    <div className="flex flex-wrap gap-4 mb-5 px-4 py-3 rounded-lg border"
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
      {thinking > 0 && <StatItem color="var(--thinking)" count={thinking} label="Thinking" />}
      <StatItem color="var(--text-primary)" count={text} label="Text" />
      <StatItem color="#ef4444" count={toolCalls} label="Tool Calls" />
      <StatItem color="var(--accent)" count={userMsgs} label="User" />
      {errors > 0 && <StatItem color="var(--danger)" count={errors} label="Errors" />}
    </div>
  );
}

function StatItem({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
      <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{count}</span>
      {label}
    </div>
  );
}

// ============ User Text ============

export function UserTextBlock({ message }: { message: SessionMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.content.length > 500;
  const displayContent = isLong && !expanded ? message.content.slice(0, 500) + '...' : message.content;

  return (
    <div className="rounded-lg p-3 mt-5 first:mt-0"
      style={{ backgroundColor: 'var(--accent-subtle)', border: '1px solid rgba(108,92,231,0.20)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'var(--accent)', color: 'white' }}>
          <User size={11} />
        </span>
        <span className="text-[12px] font-semibold" style={{ color: 'var(--accent-hover)' }}>You</span>
        <span className="text-[11px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>
          {formatTime(message.timestamp)}
        </span>
      </div>
      <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words"
        style={{ color: 'var(--text-primary)' }}>
        {displayContent}
        {isLong && (
          <button onClick={() => setExpanded(!expanded)}
            className="ml-1 text-[11px] font-medium"
            style={{ color: 'var(--accent)' }}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

// ============ Assistant Text ============

export function AssistantTextBlock({ message, onRawJson }: {
  message: SessionMessage;
  onRawJson?: (json: string) => void;
}) {
  return (
    <div className="rounded-lg p-3"
      style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'var(--bg-active)', color: 'var(--text-secondary)' }}>
          <Bot size={11} />
        </span>
        <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Assistant</span>
        <span className="text-[11px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>
          {formatTime(message.timestamp)}
        </span>
        {message.rawJson && onRawJson && (
          <button onClick={() => onRawJson(message.rawJson!)}
            className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
            title="View Raw JSON">
            {'{ }'}
          </button>
        )}
      </div>
      <div className="text-[13px] leading-relaxed break-words"
        style={{ color: 'var(--text-primary)' }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
      />
    </div>
  );
}

// ============ Thinking Block ============

export function ThinkingBlock({ message, expanded, onToggle, onRawJson }: {
  message: SessionMessage;
  expanded: boolean;
  onToggle: () => void;
  onRawJson?: (json: string) => void;
}) {
  return (
    <div className="rounded-lg overflow-hidden cursor-pointer select-none"
      style={{
        backgroundColor: 'var(--thinking-subtle)',
        border: '1px solid var(--thinking-border)',
        borderLeft: '3px solid var(--thinking)',
      }}
      onClick={onToggle}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[10px] inline-flex w-4 justify-center flex-shrink-0 transition-transform"
          style={{ color: 'var(--thinking)', transform: expanded ? 'rotate(90deg)' : 'none' }}>
          &#9654;
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--thinking)" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
        </svg>
        <span className="text-[12px] font-medium italic" style={{ color: 'var(--thinking)' }}>
          Thinking...
        </span>
        {message.rawJson && onRawJson && (
          <button onClick={(e) => { e.stopPropagation(); onRawJson(message.rawJson!); }}
            className="ml-auto text-[10px] px-1.5 py-0.5 rounded transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
            title="View Raw JSON">
            {'{ }'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t"
          style={{ borderColor: 'var(--thinking-border)' }}
          onClick={e => e.stopPropagation()}>
          {message.isRedacted ? (
            <div className="text-[11px] italic pt-2.5" style={{ color: 'var(--text-tertiary)' }}>
              Extended thinking content is not available.
              Anthropic does not persist thinking content in newer Claude Code versions (&ge; 2.1.81).
            </div>
          ) : (
            <div className="text-[12px] leading-relaxed italic whitespace-pre-wrap break-words pt-2.5"
              style={{ color: 'var(--text-secondary)' }}>
              {message.content}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Tool Call Block ============

export function ToolCallBlock({ message, expanded, onToggle, onRawJson }: {
  message: SessionMessage;
  expanded: boolean;
  onToggle: () => void;
  onRawJson?: (json: string) => void;
}) {
  const toolStyle = getToolStyle(message.toolName || '');
  const summary = message.toolInput ? getToolSummary(message.toolName || '', message.toolInput) : '';
  const paramJson = message.toolInput ? JSON.stringify(message.toolInput, null, 2) : '';

  return (
    <div style={{ background: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-2 px-3.5 py-2 cursor-pointer transition-colors"
        style={{ background: expanded ? 'var(--bg-hover)' : 'transparent' }}
        onClick={onToggle}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'transparent'; }}>
        <span className="text-[10px] inline-flex w-4 justify-center flex-shrink-0 transition-transform"
          style={{ color: 'var(--text-tertiary)', transform: expanded ? 'rotate(90deg)' : 'none' }}>
          &#9654;
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold flex-shrink-0"
          style={{ backgroundColor: toolStyle.bg, color: toolStyle.color, fontFamily: 'var(--font-mono), monospace' }}>
          {message.toolName}
        </span>
        <span className="text-[12px] truncate flex-1 min-w-0"
          style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono), monospace' }}>
          {summary}
        </span>
        {message.rawJson && onRawJson && (
          <button onClick={(e) => { e.stopPropagation(); onRawJson(message.rawJson!); }}
            className="text-[10px] px-1.5 py-0.5 rounded transition-colors flex-shrink-0"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
            title="View Raw JSON">
            {'{ }'}
          </button>
        )}
      </div>
      {expanded && paramJson && (
        <div className="border-t px-3.5 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <pre className="text-[12px] leading-relaxed whitespace-pre-wrap break-words rounded-md p-3 max-h-[400px] overflow-y-auto"
            style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono), monospace' }}
            dangerouslySetInnerHTML={{ __html: highlightJson(paramJson) }}
          />
        </div>
      )}
    </div>
  );
}

// ============ Tool Result Block ============

export function ToolResultBlock({ message, expanded, onToggle, onRawJson }: {
  message: SessionMessage;
  expanded: boolean;
  onToggle: () => void;
  onRawJson?: (json: string) => void;
}) {
  const preview = message.content.split('\n')[0].slice(0, 100);
  const sizeStr = formatBytes(new TextEncoder().encode(message.content).length);
  const isSuccess = !message.isError && message.content.includes('has been updated successfully');

  return (
    <div style={{ background: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-2 px-3.5 py-1.5 cursor-pointer text-[12px] transition-colors"
        onClick={onToggle}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        style={{ color: message.isError ? 'var(--danger)' : 'var(--text-tertiary)' }}>
        <span className="text-[10px] inline-flex w-4 justify-center transition-transform"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
          &#9654;
        </span>
        <span className="text-[13px]">
          {message.isError ? '\u2717' : isSuccess ? '\u2713' : '\u21A9'}
        </span>
        <span className="font-medium"
          style={{ color: message.isError ? 'var(--danger)' : isSuccess ? 'var(--success)' : 'var(--text-tertiary)' }}>
          {message.isError ? 'Error' : isSuccess ? 'Success' : 'Output'}
        </span>
        <span className="truncate flex-1 min-w-0"
          style={{ fontFamily: 'var(--font-mono), monospace', fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {preview}
        </span>
        <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
          {sizeStr}
        </span>
        {message.rawJson && onRawJson && (
          <button onClick={(e) => { e.stopPropagation(); onRawJson(message.rawJson!); }}
            className="text-[10px] px-1.5 py-0.5 rounded transition-colors flex-shrink-0"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
            title="View Raw JSON">
            {'{ }'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="border-t px-3.5 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <pre className="text-[12px] leading-relaxed whitespace-pre-wrap break-words rounded-md p-3 max-h-[400px] overflow-y-auto"
            style={{
              backgroundColor: 'var(--bg-primary)',
              color: message.isError ? 'var(--danger)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono), monospace',
              border: message.isError ? '1px solid var(--danger-subtle)' : 'none',
            }}>
            {message.content || '(empty)'}
          </pre>
        </div>
      )}
    </div>
  );
}

// ============ Raw JSON Modal ============

export function RawJsonModal({ json, onClose }: { json: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  let formatted = json;
  try {
    formatted = JSON.stringify(JSON.parse(json), null, 2);
  } catch { /* use as-is */ }

  const handleCopy = () => {
    navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[80vh] rounded-xl overflow-hidden flex flex-col"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <Code2 size={14} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Raw JSON
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
              style={{ backgroundColor: 'var(--bg-active)', color: 'var(--text-secondary)' }}>
              <Copy size={11} />
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={onClose}
              className="p-1 rounded transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="text-[12px] leading-relaxed whitespace-pre-wrap break-words"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono), monospace' }}
            dangerouslySetInnerHTML={{ __html: highlightJson(formatted) }}
          />
        </div>
      </div>
    </div>
  );
}

// ============ Legacy Fallback ============

export function LegacyMessageBubble({ message }: { message: SessionMessage }) {
  const [expanded, setExpanded] = useState(true);
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isLong = message.content.length > 300;

  return (
    <div className="flex gap-2.5 py-2">
      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: isUser ? 'var(--accent-subtle)' : isTool ? 'var(--warning-subtle)' : 'var(--bg-tertiary)' }}>
        {isUser ? <User size={11} style={{ color: 'var(--accent)' }} /> :
         <Bot size={11} style={{ color: 'var(--text-secondary)' }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-medium" style={{ color: isUser ? 'var(--accent)' : 'var(--text-secondary)' }}>
            {isUser ? 'You' : isTool ? 'Tool' : 'Assistant'}
          </span>
          {message.timestamp && (
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              {formatTime(message.timestamp)}
            </span>
          )}
        </div>
        <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap break-words"
          style={{ color: 'var(--text-primary)' }}>
          {isLong && !expanded ? (
            <>
              {message.content.slice(0, 300)}...
              <button onClick={() => setExpanded(true)} className="ml-1 text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
                Show more
              </button>
            </>
          ) : message.content}
          {isLong && expanded && (
            <button onClick={() => setExpanded(false)} className="ml-1 text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
              Show less
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
