import { Fragment, ReactNode } from 'react';

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'code'; value: string };

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] };

const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/g;

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const raw = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, index) });
    }

    if (raw.startsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ type: 'strong', value: raw.slice(2, -2) });
    } else {
      tokens.push({ type: 'em', value: raw.slice(1, -1) });
    }

    lastIndex = index + raw.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return tokens;
}

function renderInline(text: string): ReactNode[] {
  return parseInline(text).map((token, index) => {
    const key = `${token.type}-${index}`;
    switch (token.type) {
      case 'strong':
        return <strong key={key}>{token.value}</strong>;
      case 'em':
        return <em key={key}>{token.value}</em>;
      case 'code':
        return (
          <code
            key={key}
            className="px-1 py-0.5 rounded text-[0.95em]"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
          >
            {token.value}
          </code>
        );
      default:
        return <Fragment key={key}>{token.value}</Fragment>;
    }
  });
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      i += 1;
      continue;
    }

    if (/^[-*+]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const current = lines[i].trimEnd();
      if (!current.trim()) break;
      if (/^(#{1,3})\s+/.test(current)) break;
      if (/^[-*+]\s+/.test(current.trim())) break;
      if (/^\d+\.\s+/.test(current.trim())) break;
      paragraphLines.push(current);
      i += 1;
    }

    blocks.push({
      type: 'paragraph',
      text: paragraphLines.join('\n'),
    });
  }

  return blocks;
}

function renderParagraph(text: string) {
  return text.split('\n').map((line, index) => (
    <Fragment key={`line-${index}`}>
      {index > 0 && <br />}
      {renderInline(line)}
    </Fragment>
  ));
}

export function SimpleMarkdown({ content, className = '' }: { content: string; className?: string }) {
  const blocks = parseBlocks(content);

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const sizeClass =
            block.level === 1 ? 'text-[14px]' : block.level === 2 ? 'text-[13px]' : 'text-[12.5px]';
          return (
            <h3
              key={`block-${index}`}
              className={`${sizeClass} font-semibold mt-3 first:mt-0 mb-1.5`}
              style={{ color: 'var(--text-primary)' }}
            >
              {renderInline(block.text)}
            </h3>
          );
        }

        if (block.type === 'unordered-list') {
          return (
            <ul
              key={`block-${index}`}
              className="list-disc pl-5 my-2 space-y-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`item-${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ordered-list') {
          return (
            <ol
              key={`block-${index}`}
              className="list-decimal pl-5 my-2 space-y-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`item-${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }

        return (
          <p
            key={`block-${index}`}
            className="my-2 first:mt-0 last:mb-0"
            style={{ color: 'var(--text-secondary)' }}
          >
            {renderParagraph(block.text)}
          </p>
        );
      })}
    </div>
  );
}

export function stripSimpleMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/(`+)(.*?)\1/g, '$2')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/\n{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
