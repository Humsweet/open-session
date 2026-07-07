'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  CalendarDays,
  AlertTriangle,
  Cpu,
  ChevronRight,
  ChevronDown,
  Sparkles,
  MessageSquare,
  ListChecks,
  X,
} from 'lucide-react';
import type { DailyDigest, DigestItem, ValueTier, ValueLine, WorkCategory } from '@/lib/daily-digest/types';
import { CATEGORY_LABELS, LINE_LABELS } from '@/lib/daily-digest/rubric';
import { DigestCalendar, toKey } from '@/components/digest-calendar';

/** 用户对某条 item 的批注（留言 + 可选的档/线纠正）。与 GET/POST /api/daily/feedback 契约一致。 */
interface ItemFeedback {
  sessionId: string;
  date: string;
  itemTitle: string;
  aiTier: ValueTier;
  aiLine: ValueLine;
  aiCategory: WorkCategory;
  comment: string;
  suggestedTier: ValueTier | null;
  suggestedLine: ValueLine | null;
  updatedAt: string;
}

const TIER_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: '不改' },
  { value: 'S', label: 'S' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
];

const LINE_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: '不改' },
  { value: 'career', label: LINE_LABELS.career },
  { value: 'personal', label: LINE_LABELS.personal },
  { value: 'consumption', label: LINE_LABELS.consumption },
];

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

// 日报生成模型：与 settings 一致，外加 copilot。默认值取 GET /api/settings 的 digest_model。
const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'copilot', label: 'Copilot' },
];

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

/** 批注编辑区里的小段选择器（档位 / 线位）：不改 / 具体取值。 */
function MiniPicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: string | null; label: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1">
      {options.map(opt => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.label}
            type="button"
            disabled={disabled}
            onClick={e => {
              e.stopPropagation();
              e.preventDefault();
              onChange(opt.value);
            }}
            className="px-2 py-0.5 rounded border text-[11px] font-medium transition-colors"
            style={{
              backgroundColor: selected ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
              borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
              color: selected ? 'var(--accent)' : 'var(--text-secondary)',
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** 建议纠正的一句话摘要，如「建议 → S · 职业」。无纠正返回空串。 */
function suggestSummary(fb: ItemFeedback): string {
  const parts: string[] = [];
  if (fb.suggestedTier) parts.push(fb.suggestedTier);
  if (fb.suggestedLine) parts.push(LINE_LABELS[fb.suggestedLine]);
  return parts.length ? `建议 → ${parts.join(' · ')}` : '';
}

function ItemRow({
  item,
  date,
  feedback,
  onSaved,
}: {
  item: DigestItem;
  date: string;
  feedback?: ItemFeedback;
  onSaved: (sessionId: string, fb: ItemFeedback | null) => void;
}) {
  const tier = TIER_META[item.tier];
  const sid = item.sessionIds[0];
  const hasFeedback = !!feedback;

  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [sTier, setSTier] = useState<string | null>(null);
  const [sLine, setSLine] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!open) {
      // 打开时用已有批注回填
      setComment(feedback?.comment ?? '');
      setSTier(feedback?.suggestedTier ?? null);
      setSLine(feedback?.suggestedLine ?? null);
    }
    setOpen(v => !v);
  };

  const save = async () => {
    if (!sid) return;
    setSaving(true);
    const trimmed = comment.trim();
    try {
      const res = await fetch('/api/daily/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          sessionId: sid,
          itemTitle: item.title,
          aiTier: item.tier,
          aiLine: item.line,
          aiCategory: item.category,
          comment: trimmed,
          suggestedTier: sTier,
          suggestedLine: sLine,
        }),
      });
      if (res.ok) {
        const cleared = !trimmed && !sTier && !sLine;
        if (cleared) {
          onSaved(sid, null);
        } else {
          onSaved(sid, {
            sessionId: sid,
            date,
            itemTitle: item.title,
            aiTier: item.tier,
            aiLine: item.line,
            aiCategory: item.category,
            comment: trimmed,
            suggestedTier: sTier as ValueTier | null,
            suggestedLine: sLine as ValueLine | null,
            updatedAt: new Date().toISOString(),
          });
        }
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const summary = feedback ? suggestSummary(feedback) : '';

  const content = (
    <div className="flex gap-3 px-3 py-2.5">
      <span
        className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[12px] font-bold tabular-nums"
        style={{ color: tier.color, backgroundColor: tier.subtle, fontFamily: 'var(--font-mono)' }}
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
          {sid && (
            <button
              type="button"
              onClick={toggle}
              className="inline-flex items-center ml-auto px-1.5 py-1 rounded transition-colors"
              style={{
                color: hasFeedback ? 'var(--accent)' : 'var(--text-tertiary)',
                backgroundColor: open ? 'var(--accent-subtle)' : 'transparent',
              }}
              title={hasFeedback ? '查看 / 编辑批注' : '添加批注'}
            >
              <span className="relative inline-flex">
                <MessageSquare size={14} />
                {hasFeedback && (
                  <span
                    className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                )}
              </span>
            </button>
          )}
        </div>
        {hasFeedback && !open && (
          <div
            className="mt-1.5 flex items-start gap-1.5 rounded-md px-2 py-1 text-[11.5px] leading-snug"
            style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--text-secondary)' }}
          >
            <MessageSquare size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span className="min-w-0">
              {feedback!.comment && <span>{feedback!.comment}</span>}
              {summary && (
                <span style={{ color: 'var(--accent)' }}>
                  {feedback!.comment ? '　' : ''}
                  {summary}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="rounded-lg transition-colors"
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      {sid ? (
        <Link href={`/sessions/${sid}`} className="block">
          {content}
        </Link>
      ) : (
        content
      )}

      {open && sid && (
        <div className="px-3 pb-3 pt-0.5" onClick={e => e.stopPropagation()}>
          <div
            className="rounded-lg border p-2.5 space-y-2.5"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-primary)' }}
          >
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder="你对这条的优先度 / 总结怎么看？"
              className="w-full resize-y rounded-md border px-2.5 py-2 text-[12.5px] leading-snug outline-none"
              style={{
                borderColor: 'var(--border-subtle)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-[11.5px]" style={{ color: 'var(--text-tertiary)' }}>
                我认为应判为：
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  档位
                </span>
                <MiniPicker options={TIER_OPTIONS} value={sTier} onChange={setSTier} disabled={saving} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  线位
                </span>
                <MiniPicker options={LINE_OPTIONS} value={sLine} onChange={setSLine} disabled={saving} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#fff',
                  opacity: saving ? 0.65 : 1,
                  cursor: saving ? 'default' : 'pointer',
                }}
              >
                {saving ? (
                  <>
                    <RefreshCw size={13} className="animate-spin motion-reduce:animate-none" />
                    保存中…
                  </>
                ) : (
                  '保存'
                )}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  cursor: saving ? 'default' : 'pointer',
                }}
              >
                取消
              </button>
              <span className="ml-auto text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                留空并全选「不改」= 清除批注
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 一天的完整总结渲染（headline + 分档 items）。日历详情态复用。 */
function DayCard({
  digest,
  date,
  feedback,
  onSaved,
}: {
  digest: DailyDigest;
  date: string;
  feedback: Record<string, ItemFeedback>;
  onSaved: (sessionId: string, fb: ItemFeedback | null) => void;
}) {
  const tiers: ValueTier[] = ['S', 'A', 'B'];
  const partial = digest.status === 'partial';
  // B (消耗/未落地) is collapsed by default so S/A value reads at a glance.
  const [showB, setShowB] = useState(false);
  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
    >
      {(digest.headline || partial) && (
        <header className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-start justify-between gap-3">
            {digest.headline ? (
              <div className="text-[13.5px] leading-snug min-w-0" style={{ color: 'var(--accent)' }}>
                {digest.headline}
              </div>
            ) : (
              <span />
            )}
            {partial && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] shrink-0"
                style={{ color: 'var(--warning)', backgroundColor: 'var(--warning-subtle)' }}
                title="部分数据源当天不可达，待日后补齐"
              >
                <AlertTriangle size={11} /> mac-mini 部分待补
              </span>
            )}
          </div>
        </header>
      )}

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
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
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
                  rows.map((item, i) => (
                    <ItemRow
                      key={`${tier}-${i}`}
                      item={item}
                      date={date}
                      feedback={item.sessionIds[0] ? feedback[item.sessionIds[0]] : undefined}
                      onSaved={onSaved}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/** 模型选择器：分段式 pill，选中态用 accent-subtle + accent 边框（与 settings 一致）。 */
function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {MODEL_OPTIONS.map(opt => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className="px-2.5 py-1 rounded-md border text-[12px] font-medium transition-colors"
            style={{
              backgroundColor: selected ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
              borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
              color: selected ? 'var(--accent)' : 'var(--text-secondary)',
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** 选中某天的详情面板：有总结 → 完整渲染 + 重新生成；无总结 → 空态 + 生成。 */
function DetailPanel({
  date,
  digest,
  model,
  onModelChange,
  onGenerate,
  busy,
}: {
  date: string;
  digest: DailyDigest | undefined;
  model: string;
  onModelChange: (v: string) => void;
  onGenerate: () => void;
  busy: boolean;
}) {
  const hasDigest = !!digest;

  // 当天批注：切换日期 / 重新生成时重新拉取；就地更新，不整页重拉。
  const [feedback, setFeedback] = useState<Record<string, ItemFeedback>>({});
  useEffect(() => {
    setFeedback({});
    if (!digest) return;
    let cancelled = false;
    fetch(`/api/daily/feedback?date=${date}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setFeedback(data.feedback || {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date, digest]);

  const handleSaved = useCallback((sessionId: string, fb: ItemFeedback | null) => {
    setFeedback(prev => {
      const next = { ...prev };
      if (fb) next[sessionId] = fb;
      else delete next[sessionId];
      return next;
    });
  }, []);

  return (
    <div className="space-y-3">
      {/* Detail header: date + model picker + action */}
      <div
        className="rounded-xl border p-4"
        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {weekdayOf(date)}
          </span>
          <span className="text-[13px] tabular-nums" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {date}
          </span>
          {hasDigest && (
            <span className="text-[11px] tabular-nums ml-auto" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {digest!.sessionCount} 会话 · {digest!.model}
            </span>
          )}
        </div>

        {!hasDigest && (
          <p className="text-[12.5px] mb-3 leading-snug" style={{ color: 'var(--text-tertiary)' }}>
            这天还没有总结。选好模型后手动按日生成 —— 会拉取当天所有 agent 会话、按价值原则归类分级。生成可能耗时几十秒到数分钟，请耐心等待。
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[11px] mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
              模型
            </div>
            <ModelPicker value={model} onChange={onModelChange} disabled={busy} />
          </div>
          <button
            onClick={onGenerate}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[13px] font-medium transition-colors"
            style={{
              backgroundColor: 'var(--accent)',
              color: '#fff',
              opacity: busy ? 0.65 : 1,
              cursor: busy ? 'default' : 'pointer',
            }}
            onMouseEnter={e => {
              if (!busy) e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
            }}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
          >
            {busy ? (
              <>
                <RefreshCw size={14} className="animate-spin motion-reduce:animate-none" />
                正在总结…
              </>
            ) : hasDigest ? (
              <>
                <RefreshCw size={14} />
                重新生成
              </>
            ) : (
              <>
                <Sparkles size={14} />
                总结当日
              </>
            )}
          </button>
        </div>
      </div>

      {/* Full digest body (only when a digest exists) */}
      {hasDigest && <DayCard digest={digest!} date={date} feedback={feedback} onSaved={handleSaved} />}
    </div>
  );
}

/** 优先度原则面板：展示当前蒸馏出的原则文本，可按当前模型「根据留言更新」。 */
function PrinciplesPanel({ model, onClose }: { model: string; onClose: () => void }) {
  const [data, setData] = useState<{ content: string; updatedAt: string | null; rawCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadP = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/daily/principles');
      const d = await r.json();
      setData({ content: d.content || '', updatedAt: d.updatedAt ?? null, rawCount: d.rawCount ?? 0 });
    } catch {
      setErr('原则加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadP();
  }, [loadP]);

  const distill = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/daily/principles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error || '更新失败');
      } else {
        await loadP(); // 拉权威的 content / rawCount / updatedAt
      }
    } catch {
      setErr('更新失败');
    } finally {
      setBusy(false);
    }
  };

  const hasContent = !!data?.content?.trim();

  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <ListChecks size={16} style={{ color: 'var(--accent)' }} />
        <span className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          优先度原则
        </span>
        {data && (
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {data.rawCount} 条留言
            {data.updatedAt ? ` · ${data.updatedAt.slice(0, 10)}` : ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={distill}
            disabled={busy || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
            style={{
              backgroundColor: 'var(--accent)',
              color: '#fff',
              opacity: busy || loading ? 0.65 : 1,
              cursor: busy || loading ? 'default' : 'pointer',
            }}
          >
            {busy ? (
              <>
                <RefreshCw size={13} className="animate-spin motion-reduce:animate-none" />
                蒸馏中…
              </>
            ) : (
              <>
                <Sparkles size={13} />
                根据我的留言更新原则
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors"
            style={{ color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-tertiary)' }}
            title="收起"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {err && (
        <div
          className="mb-3 px-3 py-2 rounded-md text-[12px] flex items-center gap-1.5"
          style={{ color: 'var(--danger)', backgroundColor: 'var(--danger-subtle)' }}
        >
          <AlertTriangle size={12} />
          {err}
        </div>
      )}

      {loading ? (
        <p className="text-[12.5px]" style={{ color: 'var(--text-tertiary)' }}>
          加载中…
        </p>
      ) : hasContent ? (
        <div
          className="text-[12.5px] leading-relaxed whitespace-pre-wrap"
          style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
        >
          {data!.content}
        </div>
      ) : (
        <p className="text-[12.5px] leading-snug" style={{ color: 'var(--text-tertiary)' }}>
          还没有蒸馏出原则，先去给日报条目留言，再点更新。
        </p>
      )}
    </div>
  );
}

export default function DailyPage() {
  const now = new Date();
  const todayKey = toKey(now.getFullYear(), now.getMonth(), now.getDate());

  const [digests, setDigests] = useState<Record<string, DailyDigest>>({});
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const [selected, setSelected] = useState<string | null>(null);
  const [model, setModel] = useState('opus');
  const [loading, setLoading] = useState(true);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [principlesOpen, setPrinciplesOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/daily');
      const data = await res.json();
      const map: Record<string, DailyDigest> = {};
      for (const d of (data.digests || []) as DailyDigest[]) map[d.date] = d;
      setDigests(map);
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 默认模型取 settings.digest_model
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data.digest_model) setModel(data.digest_model);
      })
      .catch(() => {});
  }, [load]);

  const generate = useCallback(
    async (date: string) => {
      setBusyDate(date);
      setError(null);
      try {
        const res = await fetch('/api/daily', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, model }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || '生成失败');
        } else if (data.digest) {
          // 就地更新地图与详情，避免整表重拉
          setDigests(prev => ({ ...prev, [date]: data.digest as DailyDigest }));
        } else {
          await load();
        }
      } catch {
        setError('生成失败');
      } finally {
        setBusyDate(null);
      }
    },
    [model, load]
  );

  const navigate = useCallback((delta: number) => {
    setMonth(prev => {
      const m = prev + delta;
      if (m < 0) {
        setYear(y => y - 1);
        return 11;
      }
      if (m > 11) {
        setYear(y => y + 1);
        return 0;
      }
      return m;
    });
  }, []);

  const goToday = useCallback(() => {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(toKey(d.getFullYear(), d.getMonth(), d.getDate()));
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center gap-2 mb-5">
        <CalendarDays size={20} style={{ color: 'var(--accent)' }} />
        <h1 className="text-[17px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          每日工作总结
        </h1>
        <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
          按日历浏览，手动按日生成
        </span>
        <button
          type="button"
          onClick={() => setPrinciplesOpen(v => !v)}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[12.5px] font-medium transition-colors"
          style={{
            backgroundColor: principlesOpen ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
            borderColor: principlesOpen ? 'var(--accent)' : 'var(--border-subtle)',
            color: principlesOpen ? 'var(--accent)' : 'var(--text-secondary)',
          }}
        >
          <ListChecks size={14} />
          优先度原则
        </button>
      </div>

      {principlesOpen && <PrinciplesPanel model={model} onClose={() => setPrinciplesOpen(false)} />}

      {error && (
        <div
          className="mb-4 px-3 py-2 rounded-md text-[12.5px] flex items-center gap-1.5"
          style={{ color: 'var(--danger)', backgroundColor: 'var(--danger-subtle)' }}
        >
          <AlertTriangle size={13} />
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          加载中…
        </p>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5 items-start">
          <div className="shrink-0 w-full lg:w-auto">
            <DigestCalendar
              year={year}
              month={month}
              digests={digests}
              todayKey={todayKey}
              selectedKey={selected}
              onSelect={setSelected}
              onNavigate={navigate}
              onToday={goToday}
            />
          </div>

          <div className="flex-1 min-w-0 w-full">
            {selected ? (
              <DetailPanel
                date={selected}
                digest={digests[selected]}
                model={model}
                onModelChange={setModel}
                onGenerate={() => generate(selected)}
                busy={busyDate === selected}
              />
            ) : (
              <div
                className="rounded-xl border px-4 py-6 text-center text-[12.5px]"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
              >
                点选一个日期查看当天总结，或对没有总结的日期手动生成。
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
