import { getDb } from '../db/client';

/**
 * 用户对某天日报里**单条 item** 的留言反馈。以 sessionId 为主键——一条 item 的主
 * 来源 session id 唯一标识它（合并 item 时取 primary session）。留言原文长期留存，
 * 供后续「蒸馏」成个人优先度校准原则（见 ./principles.ts）。
 */
export interface ItemFeedback {
  sessionId: string;
  date: string;
  itemTitle: string;
  aiTier: string;
  aiLine: string;
  aiCategory: string;
  comment: string;
  /** 用户建议的档位纠正（S/A/B），无则 null。 */
  suggestedTier: string | null;
  /** 用户建议的线纠正（career/personal/consumption），无则 null。 */
  suggestedLine: string | null;
  updatedAt: string;
}

interface FeedbackRow {
  session_id: string;
  date: string;
  item_title: string | null;
  ai_tier: string | null;
  ai_line: string | null;
  ai_category: string | null;
  comment: string | null;
  suggested_tier: string | null;
  suggested_line: string | null;
  updated_at: string;
}

function rowToFeedback(row: FeedbackRow): ItemFeedback {
  return {
    sessionId: row.session_id,
    date: row.date,
    itemTitle: row.item_title ?? '',
    aiTier: row.ai_tier ?? '',
    aiLine: row.ai_line ?? '',
    aiCategory: row.ai_category ?? '',
    comment: row.comment ?? '',
    suggestedTier: row.suggested_tier ?? null,
    suggestedLine: row.suggested_line ?? null,
    updatedAt: row.updated_at,
  };
}

/**
 * Upsert 一条 item 反馈。**清空语义**：当 comment 为空且 suggestedTier /
 * suggestedLine 都为 null 时，视为「用户清空了留言」→ 删除该行，而不是留一条空反馈。
 */
export function saveItemFeedback(fb: ItemFeedback): void {
  const db = getDb();
  const emptyComment = !fb.comment || !fb.comment.trim();
  if (emptyComment && fb.suggestedTier == null && fb.suggestedLine == null) {
    db.prepare('DELETE FROM digest_item_feedback WHERE session_id = ?').run(fb.sessionId);
    return;
  }
  db.prepare(
    `INSERT INTO digest_item_feedback
       (session_id, date, item_title, ai_tier, ai_line, ai_category, comment, suggested_tier, suggested_line, updated_at)
     VALUES (@session_id, @date, @item_title, @ai_tier, @ai_line, @ai_category, @comment, @suggested_tier, @suggested_line, @updated_at)
     ON CONFLICT(session_id) DO UPDATE SET
       date = excluded.date,
       item_title = excluded.item_title,
       ai_tier = excluded.ai_tier,
       ai_line = excluded.ai_line,
       ai_category = excluded.ai_category,
       comment = excluded.comment,
       suggested_tier = excluded.suggested_tier,
       suggested_line = excluded.suggested_line,
       updated_at = excluded.updated_at`
  ).run({
    session_id: fb.sessionId,
    date: fb.date,
    item_title: fb.itemTitle,
    ai_tier: fb.aiTier,
    ai_line: fb.aiLine,
    ai_category: fb.aiCategory,
    comment: fb.comment,
    suggested_tier: fb.suggestedTier,
    suggested_line: fb.suggestedLine,
    updated_at: fb.updatedAt,
  });
}

/** 某天所有 item 反馈，按 sessionId 索引，供前端渲染留言态。 */
export function getFeedbackForDate(date: string): Record<string, ItemFeedback> {
  const rows = getDb()
    .prepare('SELECT * FROM digest_item_feedback WHERE date = ?')
    .all(date) as FeedbackRow[];
  const out: Record<string, ItemFeedback> = {};
  for (const row of rows) out[row.session_id] = rowToFeedback(row);
  return out;
}

/** 全部反馈，按 updatedAt 升序（供蒸馏时按时间脉络喂给模型）。 */
export function listAllFeedback(): ItemFeedback[] {
  const rows = getDb()
    .prepare('SELECT * FROM digest_item_feedback ORDER BY updated_at ASC, date ASC')
    .all() as FeedbackRow[];
  return rows.map(rowToFeedback);
}

/** 现存反馈条数（原始留言数，展示在原则页上「由 N 条留言蒸馏」）。 */
export function countFeedback(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM digest_item_feedback')
    .get() as { n: number };
  return row.n;
}
