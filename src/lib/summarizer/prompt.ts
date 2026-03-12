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

请输出:
1. 一句话概述 (这个 session 的目标是什么)
2. 完成状态 (已完成 / 进行中 / 可能中断)
3. 关键操作列表 (3-5 个要点)
4. 如果是"进行中"，下一步可能需要做什么`;
}
