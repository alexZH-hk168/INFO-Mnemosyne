// SKILL.md 渲染用的解析与高亮（规格 3-条目卡片-Skill详情页：正文用 Markdown 渲染，代码块高亮）。
// 只实现 SKILL.md 常用的子集：YAML 头部、标题、段落、无序/有序列表、引用、代码块、行内代码、粗体、链接。
// 自写，不引入 Markdown 库（docs/DEVELOPMENT.md「不引入规格没要求的 UI 库」）。不使用 innerHTML，全部生成 React 节点。
import type { ReactNode } from 'react';

export interface FrontMatter {
  raw: string;
  fields: Record<string, string>;
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'rule' };

/** 拆出 `---` 包住的 YAML 头部；只解析一层 `key: value` */
export function splitFrontMatter(md: string): { front: FrontMatter | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { front: null, body: md };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { front: { raw: m[0].trimEnd(), fields }, body: md.slice(m[0].length) };
}

const slug = (s: string, used: Map<string, number>) => {
  const base =
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'section';
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n ? `${base}-${n}` : base;
};

export function parseBlocks(body: string): Block[] {
  const lines = body.split(/\r?\n/);
  const blocks: Block[] = [];
  const used = new Map<string, number>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith(fence[1])) buf.push(lines[i++]);
      i += 1;
      blocks.push({ kind: 'code', lang: fence[2].toLowerCase(), text: buf.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (h) {
      blocks.push({ kind: 'heading', level: h[1].length, text: h[2], id: slug(h[2], used) });
      i += 1;
      continue;
    }
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) items.push(m[2]);
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: buf.join(' ') });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|~~~|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]))
      buf.push(lines[i++].trim());
    blocks.push({ kind: 'para', text: buf.join(' ') });
  }
  return blocks;
}

/** 目录：二级标题为条目，其下三级标题合成一行（概念图 UI-10「目录」卡） */
export function headingsOf(body: string): Heading[] {
  return parseBlocks(body)
    .filter((b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading')
    .map(({ level, text, id }) => ({ level, text: stripInline(text), id }));
}

const stripInline = (s: string) => s.replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(
        <code
          key={k++}
          className="rounded-chip bg-[var(--code-bg)] px-1 font-mono text-[0.92em] text-[var(--code-ink)]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      out.push(
        <strong key={k++} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const safe = /^https?:\/\//.test(lm[2]);
      out.push(
        safe ? (
          <a
            key={k++}
            href={lm[2]}
            target="_blank"
            rel="noreferrer"
            className="mn-focus text-ink underline underline-offset-2"
          >
            {lm[1]}
          </a>
        ) : (
          <span key={k++} className="text-ink">
            {lm[1]}
          </span>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const KEYWORDS = new Set(
  (
    'import from as def class return if elif else for while in not and or with try except finally raise pass lambda yield ' +
    'None True False const let var function async await export default new null undefined true false typeof interface type'
  ).split(' '),
);

/** 极简代码高亮：注释、字符串、关键字、函数调用名 */
export function highlight(code: string, lang: string): ReactNode[] {
  const cLike = ['js', 'ts', 'javascript', 'typescript', 'jsx', 'tsx', 'java', 'c', 'cpp', 'go', 'rust'].includes(lang);
  const hashLike = ['python', 'py', 'bash', 'sh', 'shell', 'zsh', 'console', 'yaml', 'yml', 'toml'].includes(lang);
  const re =
    /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|f"(?:[^"\\\n]|\\.)*")|\b([A-Za-z_]\w*)(\s*\()?/g;
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const isComment = m[1] !== undefined && (m[1].startsWith('#') ? !cLike : !hashLike);
    if (isComment) {
      out.push(
        <span key={k++} className="text-muted">
          {m[1]}
        </span>,
      );
    } else if (m[1] !== undefined) {
      out.push(m[1]);
    } else if (m[2] !== undefined) {
      out.push(
        <span key={k++} className="text-[var(--code-str)]">
          {m[2]}
        </span>,
      );
    } else if (m[3] !== undefined) {
      if (KEYWORDS.has(m[3])) {
        out.push(
          <span key={k++} className="text-[var(--code-kw)]">
            {m[3]}
          </span>,
        );
      } else if (m[4] !== undefined) {
        out.push(
          <span key={k++} className="text-[var(--code-fn)]">
            {m[3]}
          </span>,
        );
      } else {
        out.push(m[3]);
      }
      if (m[4] !== undefined) out.push(m[4]);
    }
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
