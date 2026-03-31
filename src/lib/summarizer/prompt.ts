export function buildSummaryPrompt(sessionData: {
  tool: string;
  firstUserMessage: string;
  lastUserMessage: string;
  messageCount: number;
  cwd: string;
  messagesPreview: string;
}): string {
  return `你是一个 vibe coding session 分析助手。请用中文简洁地总结以下 AI 编码 session 的内容。

工具: ${sessionData.tool}
工作目录: ${sessionData.cwd}
消息数: ${sessionData.messageCount}

首条用户消息:
${sessionData.firstUserMessage}

末条用户消息:
${sessionData.lastUserMessage}

对话摘要 (关键消息):
${sessionData.messagesPreview}

请严格按下面格式输出，不能省略标题：

# 标题

1. 一句话概述：这个 session 的目标是什么
2. 完成状态：已完成 / 进行中 / 可能中断
3. 关键操作：
- 3-5 个要点
4. 下一步：
- 只有在"进行中"时才写；如果已完成或可能中断，请写"无"

要求:
- 第一行必须是 Markdown 一级标题，格式只能是 "# 标题"
- 标题要具体，像一个可直接用作 session 名称的短标题
- 全部内容都用中文
- 不要输出任何前言、解释或额外注释`;
}
