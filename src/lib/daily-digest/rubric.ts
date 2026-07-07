/**
 * 每日工作总结的「价值原则」正本 (Single Source of Truth)。
 *
 * 这里的 7 条原则 + 分级/归线定义，是喂给模型做「归类 + 分级 + 排序」的唯一依据。
 * 要调整原则（增删改一条、改 S/A/B 判据、改两条线的边界），**只改这一个文件**，
 * 不要在别处复制一份。UI 上展示的档位/线/类别文案，也应从这里派生的枚举读取
 * (见 ./types.ts)，避免漂移。
 *
 * 设计背景：价值不是一根轴。「可投产的 3D 压缩」「核心策划/设计」「持久的 skill」
 * 在单轴上无法互排——所以用「双线模型」：先看产出流向哪条目标线（职业 / 个人长期），
 * 两条线平权；再在同线内用「持久性/杠杆」定档 (S/A/B)。
 */

/** 价值分级：S 高杠杆资产 / A 实质推进 / B 消耗未落地。 */
export const VALUE_TIERS = ['S', 'A', 'B'] as const;

/** 价值目标线：职业 / 个人长期 / 消耗区。 */
export const VALUE_LINES = ['career', 'personal', 'consumption'] as const;

/** 活动类别标签（与「线」正交，只描述做的是哪类活儿）。 */
export const WORK_CATEGORIES = [
  'feature', // 功能
  'fix', // 修复
  'design', // 设计策划
  'research', // 研究
  'content', // 内容
  'tooling', // 工具·自动化
  'ops', // 运维
  'docs', // 文档
] as const;

/** 七条价值原则的正文（会原样嵌进 rollup prompt）。 */
export const VALUE_PRINCIPLES = `## 价值原则（判定归类/分级/排序的唯一依据）

【双线模型】价值不是一根轴。先看一件工作的产出流向哪条目标线，两条线平权、不互相压制：
- 职业线 (career)：对公司产品/业务的实在推进——可投产的成果、核心策划/设计/决策的推进、解除关键阻塞。
- 个人长期线 (personal)：沉淀为可复用能力资产——skill、自动化、工具、方法论、基础设施、可复用知识。
- 两条线都进不去的（一次性消耗、杂务、探索未果）归消耗区 (consumption)，天然靠后。

原则 1｜先归「线」，再定「档」。一件工作先判定 line（career / personal / consumption）。顶级 skill 与一次可投产的 3D 压缩可以同为 S——它们喂不同的线，但都是高价值。

原则 2｜档位由「持久性/杠杆」决定，不由忙碌程度决定。同一条线内：
- S（高杠杆资产）：会反复产生回报或跨过「能用」门槛——上线的功能、可复用工具/skill/自动化、根因性修复、可直接投产的产出（如压缩后马上能用于生成的 3D 模型）、被采纳的核心决策/设计。
- A（实质推进）：一次性但有实在产出，或核心工作迈了关键一大步但未收尾——内容产出（选题/抓取入库）、局部修复、策划/设计推进。
- B（消耗/未落地）：一次性查询、探索未落地、维护杂项、被放弃的尝试、纯环境折腾。

原则 3｜「投产就绪」高于「验证可行」。跨过「能做→在用」门槛的额外加权：马上能投入真实使用/生成的（可用的压缩模型、已上线功能）> 仅 demo / 仅证明可行 / 仅跑通。

原则 4｜完成度是「调节项」，不是主轴。一个把核心设计往前推一大步但没收尾的会话，可能高于一个做完的琐碎修复。完成度用于同档内微调，并把「探索未落地/放弃」下压到 B。

原则 5｜费时 ≠ 有价值。很久的环境配置/反复被工具坑，若没沉淀成可复用资产、也没推进任一目标线，仍归 B。防止「苦劳」顶「功劳」。

原则 6｜每条标注：线 + 档 + 一句「价值指向」。不只给 S/A/B，还要写清「把职业/个人长期具体推动了什么」。让人一眼看到的不是「忙没忙」，而是「这天把人往哪儿推了多少」。

原则 7｜每天一句「头条价值」。给出这天最高价值产出的一句话概括（通常取当天最高档、最贴近职业/个人线核心那条）。`;

/** 类别中文名（UI 与 prompt 共用，避免漂移）。 */
export const CATEGORY_LABELS: Record<(typeof WORK_CATEGORIES)[number], string> = {
  feature: '功能',
  fix: '修复',
  design: '设计策划',
  research: '研究',
  content: '内容',
  tooling: '工具·自动化',
  ops: '运维',
  docs: '文档',
};

/** 线中文名。 */
export const LINE_LABELS: Record<(typeof VALUE_LINES)[number], string> = {
  career: '职业',
  personal: '个人长期',
  consumption: '消耗',
};

export interface SessionBlurbInput {
  tool: string;
  host: string;
  project: string;
  createdAt: string;
  messageCount: number;
  firstUserMessage: string;
  lastUserMessage: string;
  messagesPreview: string;
}

/**
 * 单会话「事实浓缩」prompt：只客观说清做了什么、产出了什么、完成到什么程度，
 * 不做价值判断（价值判断留给按天 rollup，避免单条视角局限）。输出短纯文本。
 */
export function buildSessionBlurbPrompt(s: SessionBlurbInput): string {
  return `你是 AI 编码/工作 session 的事实浓缩助手。用中文客观概括下面这个 session **实际做了什么、产出了什么具体成果、完成到什么程度**。不要评价价值高低、不要排序、不要客套。

工具: ${s.tool}
机器: ${s.host}
项目目录: ${s.project}
消息数: ${s.messageCount}

首条用户消息:
${s.firstUserMessage}

末条用户消息:
${s.lastUserMessage}

对话摘录:
${s.messagesPreview}

输出要求：
- 2~4 句话，纯文本，不要标题、不要列表、不要前言。
- 必须点明：做的是什么、产出的**具体成果/artifact**（文件/功能/脚本/结论/数据等）、完成状态（已完成/进行中/中断/放弃）。
- 若这个 session 明显是另一个任务的延续或子步骤，简短点出它属于哪件事。`;
}

export interface DayRollupSessionLine {
  /** 在 rollup 输入列表中的序号，模型用它回指 source_indices。 */
  index: number;
  project: string;
  tool: string;
  host: string;
  createdAt: string;
  blurb: string;
}

/**
 * 按天 rollup prompt：喂入当天所有 session 的事实浓缩 + 价值原则，
 * 让模型输出「归线 + 分档 + 排序 + 头条」的严格 JSON。
 *
 * @param userPrinciples 可选的「用户个人优先度校准原则」（正本在
 *   src/lib/daily-digest/user-priority-principles.md，由用户留言蒸馏而来，见
 *   principles.ts）。非空时作为**用户层**追加在通用 VALUE_PRINCIPLES 之后，与其
 *   冲突时以用户层为准。这是新增层，**不改动 VALUE_PRINCIPLES 正本**。
 */
export function buildDayRollupPrompt(
  date: string,
  sessions: DayRollupSessionLine[],
  userPrinciples?: string
): string {
  const list = sessions
    .map(
      s =>
        `[#${s.index}] 项目=${s.project} 工具=${s.tool} 机器=${s.host} 开始=${s.createdAt}\n${s.blurb}`
    )
    .join('\n\n');

  // 用户层：来自 principles.ts 的 readPrinciples()（运行时 fs 读的 md 正本）。
  // 剥掉纯注释/空白后若无实质内容，则不追加，避免喂空节。
  const userLayer =
    userPrinciples && userPrinciples.replace(/<!--[\s\S]*?-->/g, '').trim()
      ? `\n\n## 用户个人优先度校准原则（当与上述通用原则冲突时，以下述为准）\n${userPrinciples.trim()}`
      : '';

  return `你是「每日工作价值总结」助手。下面是 ${date} 这一天用 AI agent 完成的所有工作（每条已做过事实浓缩）。请严格依据「价值原则」对它们归类、分级、排序，并给出这天的头条价值。全部用中文。

${VALUE_PRINCIPLES}${userLayer}

## 这一天的工作（共 ${sessions.length} 条）
${list}

## 合并规则
- 同一件事被拆成多个 session（延续/子步骤）时，合并成一个 item，用 source_indices 列出所有来源序号。
- 其余每个 session 各成一个 item。

## 输出格式（只输出一个 JSON，用 \`\`\`json 代码块包裹，不要任何额外文字）
\`\`\`json
{
  "headline": "一句话：这天最高价值的产出（原则7）",
  "items": [
    {
      "source_indices": [0],
      "title": "简短标题（可直接当条目名）",
      "line": "career | personal | consumption",
      "tier": "S | A | B",
      "category": "feature | fix | design | research | content | tooling | ops | docs",
      "value_point": "一句话价值指向：对职业/个人长期具体推动了什么（原则6）",
      "what": "一句话客观说明做了什么"
    }
  ]
}
\`\`\`

排序要求：items 按 tier 从高到低 (S→A→B)，同 tier 内 career/personal 排在 consumption 前面。line 与 tier 的判定严格按上面 7 条原则，尤其：忙碌/费时不等于高价值（原则5）、投产就绪高于验证可行（原则3）、完成度只是调节项（原则4）。`;
}
