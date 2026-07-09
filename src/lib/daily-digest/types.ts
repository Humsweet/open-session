import { VALUE_LINES, VALUE_TIERS, WORK_CATEGORIES } from './rubric';

export type ValueLine = (typeof VALUE_LINES)[number]; // 'career' | 'personal' | 'consumption'
export type ValueTier = (typeof VALUE_TIERS)[number]; // 'S' | 'A' | 'B'
export type WorkCategory = (typeof WORK_CATEGORIES)[number];

/** 某个数据源在某一天的采集覆盖状态。用于诚实表达「这天的总结是否完整」。 */
export type SourceCoverage =
  | 'covered' // 该源当天数据已采集并纳入
  | 'pending' // 该源当天不可达/未采集，待日后补齐（总结为 partial）
  | 'empty'; // 该源当天确实没有会话

/** 一条工作条目（一件事，可能由多个 session 合并而来）。 */
export interface DigestItem {
  /** 组成这件事的所有 session id（合并延续/子步骤后可能多条）。 */
  sessionIds: string[];
  title: string;
  line: ValueLine;
  tier: ValueTier;
  category: WorkCategory;
  /** 一句话价值指向：对职业/个人长期具体推动了什么（原则6）。 */
  valuePoint: string;
  /** 一句话客观说明做了什么。 */
  what: string;
  /** 归属项目（cwd 末段），用于分组/展示。 */
  project: string;
  tool: string;
  /** 'local' | 'mac-mini'，缺省视为 local。 */
  host: string;
}

/** 一天的总结整体状态。 */
export type DigestStatus =
  | 'complete' // 所有应纳入的源都已覆盖
  | 'partial' // 至少一个源 pending（如 mac-mini 当天不可达），待补齐
  | 'empty'; // 这天没有任何计入的工作

/** 当天的 token 用量 + 成本汇总（来自 ccusage，纯脚本零 LLM 调用，见 src/lib/usage）。 */
export interface DigestUsage {
  totalTokens: number;
  costUsd: number;
  /** 当天计入总结的会话里，实际拿到用量数据的会话数（分子）。 */
  sessionsMatched: number;
  /** 当天计入总结的会话总数（分母）——两者不等说明用量数据不完整
   * （如 codex/copilot/gemini 尚未支持，或 ccusage 当次同步失败）。 */
  sessionsTotal: number;
}

/** 一天的完整总结。 */
export interface DailyDigest {
  /** 本地时区的 YYYY-MM-DD；会话按 createdAt 归属到这一天（跨午夜不迁移）。 */
  date: string;
  headline: string;
  items: DigestItem[];
  coverage: Record<string, SourceCoverage>; // { local, 'mac-mini' }
  sessionCount: number;
  /** 生成本总结所用模型（如 'opus' / 'sonnet'）。 */
  model: string;
  status: DigestStatus;
  generatedAt: string;
  updatedAt: string;
  /** 未定义 = 该天总结生成于本用量功能上线前，从未同步过用量。 */
  usage?: DigestUsage;
}

/** 单会话事实浓缩的缓存内容（避免重复调用模型）。 */
export interface SessionBlurbCache {
  sessionId: string;
  /** "mtimeMs:size"，与磁盘文件不一致即失效重算，与 scan_cache 同思路。 */
  fileKey: string;
  blurb: string;
  model: string;
}
