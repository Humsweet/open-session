export function extractSummaryTitle(summary?: string): string {
  if (!summary) return '';

  const headingMatch = summary.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }

  const firstLine = summary.split(/\r?\n/, 1)[0]?.trim() || '';
  const labelMatch = firstLine.match(/^标题[:：]\s*(.+)$/);
  return labelMatch?.[1].trim() || '';
}

export function stripSummaryTitle(summary?: string): string {
  if (!summary) return '';
  return summary.replace(/^#\s+.+\n*/m, '').trim();
}

export function extractSummaryOverview(summary?: string): string {
  const body = stripSummaryTitle(summary);
  if (!body) return '';

  const overviewPatterns = [
    /^\s*1[.、]\s*一句话概述[:：]\s*(.+)$/m,
    /^\s*一句话概述[:：]\s*(.+)$/m,
    /^\s*概述[:：]\s*(.+)$/m,
  ];

  for (const pattern of overviewPatterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return normalizePreviewLine(match[1]);
    }
  }

  const lines = body
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^[-*+]\s+/.test(line))
    .filter(line => !/^\d+[.、]\s+/.test(line));

  return normalizePreviewLine(lines[0] || '');
}

function normalizePreviewLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
