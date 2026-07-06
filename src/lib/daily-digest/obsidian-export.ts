import fs from 'fs';
import os from 'os';
import path from 'path';
import { DailyDigest } from './types';
import { listDigests } from './store';

/**
 * 单一真相源：把「每日工作总结」以按天一文件的 Markdown 表格镜像进 Obsidian。
 * 换库 / 换目录只改这两处常量。目录不存在时自动创建；整个 Obsidian 主库
 * 不存在时（如 Windows、无库的机器）优雅跳过——这是「本就该失败的边界」，
 * 不报错、不影响 digest 入库。
 */
export const OBSIDIAN_VAULT_ROOT = path.join(os.homedir(), 'Obsidian-Vault');
export const AI_DAILY_SUMMARY_DIR = path.join(OBSIDIAN_VAULT_ROOT, 'AI Daily Summary');

/** 单行净化：清掉换行，让一条信息落在一行内。空则回退占位符。 */
function oneLine(text: string | undefined): string {
  const v = (text || '').replace(/\r?\n+/g, ' ').trim();
  return v || '—';
}

/** 覆盖状态一行：local ✓ ｜ mac-mini ⏳待补。 */
function coverageLine(d: DailyDigest): string {
  const mark = (c: string) => (c === 'covered' ? '✓' : c === 'pending' ? '⏳待补' : '空');
  return Object.entries(d.coverage)
    .map(([src, cov]) => `${src} ${mark(cov)}`)
    .join(' ｜ ');
}

/** 一天的 digest → 一份带 frontmatter 的 Markdown 文档（列表版，按 S/A/B 顺序）。
 *  每条工作是一个 `### 级 · 标题` 小节，下挂一行元信息 + 做了什么 + 价值指向，
 *  Obsidian 里可折叠、可从大纲跳转，比宽表格好读。 */
function renderDigestMarkdown(d: DailyDigest): string {
  const frontmatter = [
    '---',
    `date: ${d.date}`,
    `status: ${d.status}`,
    `sessions: ${d.sessionCount}`,
    `model: ${d.model}`,
    `generated: ${d.generatedAt}`,
    'tags:',
    '  - ai-daily-summary',
    '---',
  ].join('\n');

  const title = `# ${d.date} · ${oneLine(d.headline || 'AI 工作总结')}`;
  const meta = `> 状态：${d.status} ｜ 会话数：${d.sessionCount} ｜ 模型：${d.model} ｜ 覆盖：${coverageLine(d)}`;

  const blocks = d.items.map(it => {
    const heading = `### ${it.tier} · ${oneLine(it.title)}`;
    // 元信息一行：价值线 / 类别 / 项目 / 工具 / 机器，用行内代码块让它与正文区分。
    const tags = `\`${it.line}\` · \`${it.category}\` · ${oneLine(it.project)} · ${oneLine(it.tool)} · ${oneLine(it.host)}`;
    const lines = [heading, tags, '', `- **做了什么**：${oneLine(it.what)}`];
    if ((it.valuePoint || '').trim()) lines.push(`- **价值**：${oneLine(it.valuePoint)}`);
    return lines.join('\n');
  });

  return [frontmatter, '', title, '', meta, '', ...blocks.flatMap(b => [b, '']), ''].join('\n');
}

export interface ObsidianExportResult {
  written: boolean;
  path?: string;
  /** 'empty-day' | 'vault-not-found' —— 未写入时说明原因。 */
  reason?: string;
}

/**
 * 把某一天的 digest 写成 Obsidian 里的一张表（`AI Daily Summary/YYYY-MM-DD.md`）。
 * 幂等：重新生成 / 补齐时整文件覆盖当天。空天（无计入工作）不产出文件。
 */
export function exportDigestToObsidian(d: DailyDigest): ObsidianExportResult {
  if (d.sessionCount === 0 || d.items.length === 0) {
    return { written: false, reason: 'empty-day' };
  }
  if (!fs.existsSync(OBSIDIAN_VAULT_ROOT)) {
    return { written: false, reason: 'vault-not-found' };
  }
  fs.mkdirSync(AI_DAILY_SUMMARY_DIR, { recursive: true });
  const file = path.join(AI_DAILY_SUMMARY_DIR, `${d.date}.md`);
  fs.writeFileSync(file, renderDigestMarkdown(d), 'utf8');
  return { written: true, path: file };
}

export interface ExportAllResult {
  written: number;
  skipped: number;
  dir: string;
  vaultFound: boolean;
}

/**
 * 一次性把库里已有的全部 digest 回填成 Obsidian 表格（幂等，可反复跑）。
 * 供 POST /api/daily/export 调用，给存量日子补表用。
 */
export function exportAllDigests(): ExportAllResult {
  const vaultFound = fs.existsSync(OBSIDIAN_VAULT_ROOT);
  let written = 0;
  let skipped = 0;
  for (const d of listDigests()) {
    const r = exportDigestToObsidian(d);
    if (r.written) written++;
    else skipped++;
  }
  return { written, skipped, dir: AI_DAILY_SUMMARY_DIR, vaultFound };
}
