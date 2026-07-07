import fs from 'fs';
import path from 'path';
import { getSetting } from '../db/client';
import { runDigestText } from '../summarizer/runtime';
import { listAllFeedback, ItemFeedback } from './feedback-store';

/**
 * 「用户个人优先度校准原则」的落盘正本。它是由用户在 /daily 页对每条 item 的留言
 * **蒸馏**出来的一份精炼原则清单，会作为「用户层」注入按天 rollup prompt（见
 * rubric.ts 的 buildDayRollupPrompt / generate.ts），在与通用 VALUE_PRINCIPLES
 * 冲突时以它为准。
 *
 * 为什么是一个 .md 文件而不是 import 的常量：这份内容在**运行时**被蒸馏重写，
 * 生产模式跑的是预构建产物。若用 `import` 引入，内容会在 build 时固化，蒸馏后
 * 不重新 build 就永远读到旧值。所以一律用 fs 在运行时读（readPrinciples）。
 */
export const PRINCIPLES_PATH = path.join(process.cwd(), 'src/lib/daily-digest/user-priority-principles.md');

/**
 * 运行时读原则正本。**必须用 fs，绝不能用 import**（见文件头注：import 会在 build
 * 时固化，蒸馏后不重构就读到旧值）。文件不存在时返回空串。
 */
export function readPrinciples(): string {
  try {
    return fs.readFileSync(PRINCIPLES_PATH, 'utf8');
  } catch {
    return '';
  }
}

const LINE_CN: Record<string, string> = {
  career: '职业',
  personal: '个人长期',
  consumption: '消耗',
};

function describeFeedback(fb: ItemFeedback, i: number): string {
  const aiLine = LINE_CN[fb.aiLine] ?? fb.aiLine;
  const parts = [
    `[留言 #${i + 1}]（${fb.date}）条目：${fb.itemTitle || '(无标题)'}`,
    `  AI 当时判定：档=${fb.aiTier || '?'} 线=${aiLine || '?'} 类=${fb.aiCategory || '?'}`,
    `  用户留言：${fb.comment || '(无文字，仅给了纠正)'}`,
  ];
  const corrections: string[] = [];
  if (fb.suggestedTier) corrections.push(`档应为 ${fb.suggestedTier}`);
  if (fb.suggestedLine) corrections.push(`线应为 ${LINE_CN[fb.suggestedLine] ?? fb.suggestedLine}`);
  if (corrections.length) parts.push(`  用户建议纠正：${corrections.join('，')}`);
  return parts.join('\n');
}

function buildDistillPrompt(feedbacks: ItemFeedback[]): string {
  const list = feedbacks.map(describeFeedback).join('\n\n');
  return `你是「用户个人优先度校准原则」的提炼助手。下面是用户对每日工作总结里各条目的留言与纠正——用户在表达他自己对「哪类工作更重要、AI 应该怎么给它归线/分档」的真实看法。请把这些零散留言**蒸馏**成一份精炼、可执行、供 AI 未来排序日报时遵循的「用户优先度校准原则」清单。

## 用户的全部留言与纠正（按时间先后）
${list}

## 输出要求
- 全部用中文，直接输出原则清单正文，不要前言、不要客套、不要代码块包裹。
- 按主题分组（可用「## 主题」小标题），每条原则一行，站在**用户视角**陈述其价值取向。
- 每条尽量点明「什么样的工作 → 应如何归线/分档」，并简述理由。示例风格：「涉及个人 skill 沉淀的工作即便看似消耗，也应上调至 A 档以上，因用户视其为长期资产。」
- 只提炼从留言中能**明确读出**的倾向，不要臆造用户没表达过的偏好。
- 总长度控制在 40 行以内，越精炼越好；有冲突的留言以更近期（列表更靠后）的为准。`;
}

/**
 * 把全部留言蒸馏成一份「用户优先度校准原则」md，写入 PRINCIPLES_PATH 并返回内容。
 *
 * @param model 覆盖模型选择，默认取 getSetting('digest_model','opus')。
 * @param timestamp 头注里的蒸馏时间（ISO 字符串）。**由调用方（API 层）传入**——脚本 /
 *   非请求环境不应依赖进程时钟语义，把时间来源收敛到 API 层，省略则头注不带时间。
 *
 * 无任何留言时：写入一行占位注释并返回它（不调用模型）。
 */
export async function distillPrinciples(model?: string, timestamp?: string): Promise<string> {
  const feedbacks = listAllFeedback();
  const chosenModel = model || getSetting('digest_model', 'opus');

  if (feedbacks.length === 0) {
    const empty = '<!-- 暂无留言可蒸馏：请先在 /daily 页对日报条目留言，再重新蒸馏 -->\n';
    fs.writeFileSync(PRINCIPLES_PATH, empty, 'utf8');
    return empty;
  }

  const prompt = buildDistillPrompt(feedbacks);
  const distilled = (await runDigestText(prompt, chosenModel)).trim();

  const when = timestamp ? ` 于 ${timestamp}` : '';
  const header = `<!-- 由 ${feedbacks.length} 条留言蒸馏${when}，请勿手动编辑，改留言后重新蒸馏 -->\n\n`;
  const content = header + distilled + '\n';
  fs.writeFileSync(PRINCIPLES_PATH, content, 'utf8');
  return content;
}
