'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { RefreshCw, CalendarDays, AlertTriangle, Cpu, ChevronRight, ChevronDown } from 'lucide-react';
import type { DailyDigest, DigestItem, ValueTier, ValueLine } from '@/lib/daily-digest/types';
import { CATEGORY_LABELS, LINE_LABELS } from '@/lib/daily-digest/rubric';

const TIER_META: Record<ValueTier, { label: string; color: string; subtle: string }> = {
  S: { label: '高价值', color: 'var(--accent)', subtle: 'var(--accent-subtle)' },
  A: { label: '推进', color: 'var(--warning)', subtle: 'var(--warning-subtle)' },
  B: { label: '消耗 / 未落地', color: 'var(--text-tertiary)', subtle: 'var(--bg-tertiary)' },
};

const LINE_COLOR: Record<ValueLine, string> = {
  career: 'var(--accent)',
  personal: 'var(--i2m)',
  consumption: 'var(--text-tertiary)',
};

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekdayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return WEEKDAYS[d.getDay()];
}

function Chip({ children, color, bg }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] leading-none whitespace-nowrap"
      style={{ color: color || 'var(--text-tertiary)', backgroundColor: bg || 'var(--bg-tertiary)' }}
    >
      {children}
    </span>
  );
}

function ItemRow({ item }: { item: DigestItem }) {
  const tier = TIER_META[item.tier];
  const inner = (
    <div
      className="flex gap-3 px-3 py-2.5 rounded-lg transition-colors"
      style={{ backgroundColor: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <span
        className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[12px] font-bold tabular-nums"
        style={{ color: tier.color, backgroundColor: tier.subtle }}
        title={tier.label}
      >
        {item.tier}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
          {item.title}
        </div>
        {item.valuePoint && (
          <div className="text-[12.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-secondary)' }}>
            {item.valuePoint}
          </div>
        )}
        {item.what && item.what !== item.valuePoint && (
          <div className="text-[12px] mt-0.5 leading-snug" style={{ color: 'var(--text-tertiary)' }}>
            {item.what}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <Chip color={LINE_COLOR[item.line]} bg="var(--bg-tertiary)">
            {LINE_LABELS[item.line]}
          </Chip>
          <Chip>{CATEGORY_LABELS[item.category]}</Chip>
          {item.project && <Chip>{item.project}</Chip>}
          {item.host === 'mac-mini' && (
            <Chip color="var(--thinking)" bg="var(--thinking-subtle)">
              <Cpu size={10} className="mr-0.5" /> mac-mini
            </Chip>
          )}
          {item.tool && <Chip>{item.tool.replace('-cli', '').replace('-code', '')}</Chip>}
        </div>
      </div>
    </div>
  );
  return item.sessionIds[0] ? (
    <Link href={`/sessions/${item.sessionIds[0]}`} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function DayCard({ digest, onRegenerate, busy }: { digest: DailyDigest; onRegenerate: (date: string) => void; busy: boolean }) {
  const tiers: ValueTier[] = ['S', 'A', 'B'];
  const partial = digest.status === 'partial';
  // B (消耗/未落地) is collapsed by default so S/A value reads at a glance.
  const [showB, setShowB] = useState(false);
  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
    >
      <header className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {weekdayOf(digest.date)}
              </span>
              <span className="text-[13px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                {digest.date}
              </span>
            </div>
            {digest.headline && (
              <div className="text-[13.5px] mt-1 leading-snug" style={{ color: 'var(--accent)' }}>
                {digest.headline}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {partial && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px]"
                style={{ color: 'var(--warning)', backgroundColor: 'var(--warning-subtle)' }}
                title="部分数据源当天不可达，待日后补齐"
              >
                <AlertTriangle size={11} /> mac-mini 部分待补
              </span>
            )}
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              {digest.sessionCount} 会话 · {digest.model}
            </span>
            <button
              onClick={() => onRegenerate(digest.date)}
              disabled={busy}
              title="重新生成这天"
              className="p-1 rounded transition-colors"
              style={{ color: 'var(--text-tertiary)', opacity: busy ? 0.5 : 1 }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </header>

      <div className="p-2">
        {digest.items.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px]" style={{ color: 'var(--text-tertiary)' }}>
            这天没有计入的 agent 工作。
          </p>
        ) : (
          tiers.map(tier => {
            const rows = digest.items.filter(i => i.tier === tier);
            if (rows.length === 0) return null;
            const meta = TIER_META[tier];
            const collapsible = tier === 'B';
            const collapsed = collapsible && !showB;
            return (
              <div key={tier} className="mb-1.5 last:mb-0">
                <div
                  className={`flex items-center gap-2 px-3 pt-2 pb-1 ${collapsible ? 'cursor-pointer select-none' : ''}`}
                  onClick={collapsible ? () => setShowB(v => !v) : undefined}
                >
                  {collapsible &&
                    (collapsed ? (
                      <ChevronRight size={12} style={{ color: 'var(--text-tertiary)' }} />
                    ) : (
                      <ChevronDown size={12} style={{ color: 'var(--text-tertiary)' }} />
                    ))}
                  <span className="text-[11px] font-semibold tracking-wide" style={{ color: meta.color }}>
                    {tier} · {meta.label}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {rows.length}
                  </span>
                  <span className="flex-1 h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />
                  {collapsed && (
                    <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      展开
                    </span>
                  )}
                </div>
                {!collapsed &&
                  rows.map((item, i) => <ItemRow key={`${tier}-${i}`} item={item} />)}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export default function DailyPage() {
  const [digests, setDigests] = useState<DailyDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [genDate, setGenDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/daily');
      const data = await res.json();
      setDigests(data.digests || []);
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const regenerate = useCallback(
    async (date: string) => {
      setBusyDate(date);
      setError(null);
      try {
        const res = await fetch('/api/daily', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || '生成失败');
        } else {
          await load();
        }
      } catch {
        setError('生成失败');
      } finally {
        setBusyDate(null);
      }
    },
    [load]
  );

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <CalendarDays size={20} style={{ color: 'var(--accent)' }} />
          <h1 className="text-[17px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            每日工作总结
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={genDate}
            onChange={e => setGenDate(e.target.value)}
            className="px-2 py-1 rounded-md text-[12px] border outline-none"
            style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <button
            onClick={() => genDate && regenerate(genDate)}
            disabled={!genDate || busyDate === genDate}
            className="px-3 py-1 rounded-md text-[12px] font-medium transition-colors"
            style={{ backgroundColor: 'var(--accent)', color: '#fff', opacity: !genDate ? 0.5 : 1 }}
          >
            {busyDate === genDate ? '生成中…' : '生成该日'}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mb-4 px-3 py-2 rounded-md text-[12.5px]"
          style={{ color: 'var(--danger)', backgroundColor: 'var(--danger-subtle)' }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          加载中…
        </p>
      ) : digests.length === 0 ? (
        <div
          className="rounded-xl border px-4 py-8 text-center text-[13px]"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
        >
          还没有任何日报。用右上角选个日期点「生成该日」，或等每日 00:05 的定时任务自动生成。
        </div>
      ) : (
        <div className="space-y-4">
          {digests.map(d => (
            <DayCard key={d.date} digest={d} onRegenerate={regenerate} busy={busyDate === d.date} />
          ))}
        </div>
      )}
    </div>
  );
}
