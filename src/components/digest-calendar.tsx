'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DailyDigest } from '@/lib/daily-digest/types';

const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_LABELS = [
  '1 月', '2 月', '3 月', '4 月', '5 月', '6 月',
  '7 月', '8 月', '9 月', '10 月', '11 月', '12 月',
];

const pad = (n: number) => String(n).padStart(2, '0');
export const toKey = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

/** 只把「有内容的当日总结」标绿；空总结(生成过但当天无工作)与未生成日一律正常色，不特别标注。 */
function hasContent(digest: DailyDigest | undefined): boolean {
  return !!digest && digest.status !== 'empty' && digest.items.length > 0;
}

export function DigestCalendar({
  year,
  month, // 0-based
  digests,
  todayKey,
  selectedKey,
  onSelect,
  onNavigate,
  onToday,
}: {
  year: number;
  month: number;
  digests: Record<string, DailyDigest>;
  todayKey: string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onNavigate: (delta: number) => void;
  onToday: () => void;
}) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // leading blanks + real days, padded to complete weeks
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const navBtn = 'w-6 h-6 flex items-center justify-center rounded-md transition-colors';

  return (
    <section
      className="max-w-[300px] rounded-xl border p-2.5"
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
    >
      {/* Month nav */}
      <header className="flex items-center justify-between px-1 pb-2">
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[13px] font-semibold tabular-nums"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
          >
            {year}
          </span>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {MONTH_LABELS[month]}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onToday}
            className="px-2 h-6 rounded-md text-[11px] font-medium transition-colors mr-0.5"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
          >
            今天
          </button>
          <button
            aria-label="上个月"
            onClick={() => onNavigate(-1)}
            className={navBtn}
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            aria-label="下个月"
            onClick={() => onNavigate(1)}
            className={navBtn}
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </header>

      {/* Weekday header */}
      <div className="grid grid-cols-7">
        {WEEKDAYS_SHORT.map((w, i) => (
          <div
            key={w}
            className="py-1 text-center text-[10px] font-medium"
            style={{ color: i === 0 || i === 6 ? 'var(--text-tertiary)' : 'var(--text-secondary)' }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid — iOS-style: no gridlines, small number in a circle. Only content days go green. */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (day === null) return <div key={`blank-${idx}`} className="aspect-square" />;

          const key = toKey(year, month, day);
          const green = hasContent(digests[key]);
          const isToday = key === todayKey;
          const isFuture = key > todayKey;
          const isSelected = key === selectedKey;
          const clickable = !isFuture;

          // Fill is reserved for the single "has content" meaning (soft green).
          // Selection/today are shown as rings so they never read as another marker.
          const circleBg = green ? 'var(--success-subtle)' : 'transparent';
          const numColor = green
            ? 'var(--success)'
            : isToday
            ? 'var(--accent)'
            : 'var(--text-primary)';

          return (
            <button
              key={key}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect(key)}
              className="aspect-square flex items-center justify-center"
              style={{ cursor: clickable ? 'pointer' : 'default', opacity: isFuture ? 0.35 : 1 }}
              aria-label={green ? `${key}（有总结）` : key}
              aria-pressed={isSelected}
            >
              <span
                className="relative flex items-center justify-center w-7 h-7 rounded-full text-[12px] tabular-nums transition-colors"
                style={{
                  fontFamily: 'var(--font-mono)',
                  backgroundColor: circleBg,
                  color: numColor,
                  fontWeight: isToday || green ? 600 : 400,
                }}
                onMouseEnter={e => {
                  if (clickable && !green && !isSelected)
                    e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                }}
                onMouseLeave={e => {
                  if (!green && !isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {/* today (accent) / selected (neutral) ring — composes over any fill, no layout shift */}
                {(isToday || isSelected) && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                      outline: `1.5px solid ${isToday ? 'var(--accent)' : 'var(--text-tertiary)'}`,
                      outlineOffset: '-1.5px',
                    }}
                  />
                )}
                {day}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
