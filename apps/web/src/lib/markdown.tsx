import type { ReactNode } from 'react';

/** A small, safe Markdown renderer for chat replies (no innerHTML). */
export function Markdown({ text }: { text: string }) {
  return <div className="prose-chat text-[13.5px] leading-relaxed">{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!);
      i++;
      out.push(
        <pre key={key++}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading) {
      const Tag = `h${heading[1]!.length}` as 'h1' | 'h2' | 'h3';
      out.push(<Tag key={key++}>{renderInline(heading[2]!)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]!) || /^\s*\d+\.\s+/.test(lines[i]!))) {
        items.push(lines[i]!.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(<List key={key++}>{items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}</List>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() && !/^(```|#{1,3}\s|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]!)) para.push(lines[i++]!);
    out.push(<p key={key++}>{renderInline(para.join(' '))}</p>);
  }
  return out;
}

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<code key={key++}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key++}>{m[2].slice(2, -2)}</strong>);
    else if (m[3]) {
      out.push(
        <a key={key++} href={m[5]} target="_blank" rel="noreferrer">
          {m[4]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
