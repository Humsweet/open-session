import { runSummaryEngine } from '../src/lib/summarizer/runtime';

const engine = (process.argv[2] ?? 'copilot-cli') as Parameters<typeof runSummaryEngine>[0];

const prompt = `这是一次管道连通性测试。下面这段样本文本含特殊字符，无需分析其内容：
单引号 'quoted'，双引号 "quoted"，反引号 \`code\`，JSON: [{"type":"text","text":"[Image #1] 这啥情况"}]
百分号 %PATH%，美元 $env:FOO，管道 | 和 && 以及 <重定向>。

如果你完整收到了以上文本，请只回复一行：PONG-OK`;

runSummaryEngine(engine, prompt, {
  timeoutMs: 90000,
  onStatus: s => console.error(`[status] ${s.message}`),
})
  .then(out => {
    console.log(`[${engine}] result: ${out}`);
    process.exit(out.includes('PONG-OK') ? 0 : 2);
  })
  .catch(err => {
    console.error(`[${engine}] FAILED: ${err.message}`);
    process.exit(1);
  });
