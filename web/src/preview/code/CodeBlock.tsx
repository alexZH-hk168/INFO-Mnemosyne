// 只读代码块：行号 + Shiki 着色 + 高亮行（#fbe8a6 整行底色）。超过 5000 行时按固定行高虚拟滚动（规格 2-文件行-代码预览「状态」）。
import { memo, useEffect, useMemo, useState } from 'react';
import type { ThemedToken } from 'shiki/core';
import { langOf, tokenize } from './highlight';

export const ROW_H = 20;
export const VIRTUAL_THRESHOLD = 5000;
const OVERSCAN = 40;

interface Props {
  code: string;
  filename: string;
  /** 高亮的行（从 1 开始的闭区间，契约 v0.2） */
  highlight?: [number, number] | null;
  /** 列表项 testid 前缀，如 `right.code-preview` 或 `right.code-preview.cell:3` */
  idPrefix: string;
  /** 外层滚动容器（虚拟滚动用） */
  scroller?: HTMLElement | null;
  lang?: string | null;
}

export function splitLines(code: string): string[] {
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  // 末尾换行不算一行
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 异步着色：先按纯文本显示，token 到了再换 */
export function useTokens(code: string, lang: string | null): ThemedToken[][] | null {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  useEffect(() => {
    let live = true;
    setTokens(null);
    tokenize(code, lang).then(
      (t) => live && setTokens(t),
      () => live && setTokens(null),
    );
    return () => {
      live = false;
    };
  }, [code, lang]);
  return tokens;
}

const Line = memo(function Line({
  n,
  text,
  tokens,
  hl,
  idPrefix,
  digits,
  top,
}: {
  n: number;
  text: string;
  tokens?: ThemedToken[];
  hl: boolean;
  idPrefix: string;
  digits: number;
  top?: number;
}) {
  return (
    <div
      data-testid={`${idPrefix}.line:${n}`}
      data-line={n}
      data-hl={hl || undefined}
      className={`flex min-w-full ${hl ? 'bg-evi-hl' : ''}`}
      style={top !== undefined ? { position: 'absolute', top, left: 0, right: 0, height: ROW_H } : { minHeight: ROW_H }}
    >
      <span
        aria-hidden="true"
        className={`sticky left-0 flex-none select-none pr-3 text-right tabular-nums ${hl ? 'bg-evi-hl text-evi-ink' : 'bg-surface text-faint'}`}
        style={{ width: `${digits + 2.2}ch` }}
      >
        {n}
      </span>
      <span className="whitespace-pre pr-4">
        {tokens
          ? tokens.map((t, i) => (
              <span key={i} style={{ color: t.color }}>
                {t.content}
              </span>
            ))
          : text || ' '}
      </span>
    </div>
  );
});

export default function CodeBlock({ code, filename, highlight, idPrefix, scroller, lang }: Props) {
  const lines = useMemo(() => splitLines(code), [code]);
  const language = lang === undefined ? langOf(filename) : lang;
  const tokens = useTokens(code, language);
  const digits = String(lines.length).length;
  const [s, e] = highlight ?? [0, -1];
  const virtual = lines.length > VIRTUAL_THRESHOLD;

  const [range, setRange] = useState<[number, number]>([0, 200]);
  useEffect(() => {
    if (!virtual || !scroller) return;
    const update = () => {
      const first = Math.floor(scroller.scrollTop / ROW_H);
      const count = Math.ceil(scroller.clientHeight / ROW_H);
      setRange([Math.max(0, first - OVERSCAN), Math.min(lines.length, first + count + OVERSCAN)]);
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [virtual, scroller, lines.length]);

  const cls = 'relative font-mono text-[12px] leading-[20px] text-[var(--code-ink)]';
  if (virtual) {
    const out = [];
    for (let i = range[0]; i < range[1]; i++) {
      out.push(
        <Line
          key={i}
          n={i + 1}
          text={lines[i]}
          tokens={tokens?.[i]}
          hl={i + 1 >= s && i + 1 <= e}
          idPrefix={idPrefix}
          digits={digits}
          top={i * ROW_H}
        />,
      );
    }
    return (
      <div data-virtual="true" className={cls} style={{ height: lines.length * ROW_H }}>
        {out}
      </div>
    );
  }
  return (
    <div className={cls}>
      {lines.map((text, i) => (
        <Line
          key={i}
          n={i + 1}
          text={text}
          tokens={tokens?.[i]}
          hl={i + 1 >= s && i + 1 <= e}
          idPrefix={idPrefix}
          digits={digits}
        />
      ))}
    </div>
  );
}
