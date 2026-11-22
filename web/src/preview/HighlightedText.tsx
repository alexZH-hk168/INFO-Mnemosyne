// 按段落显示纯文本，并把一段字符区间标成高亮（网页快照与历史对话预览共用）。
// range 是码点偏移、左闭右开（契约 v0.2），这里换算成 UTF-16 下标。
import { forwardRef, type Ref } from 'react';
import { cpToUtf16 } from '../lib/citations';

interface Props {
  text: string;
  /** 码点区间 [start, end) */
  range?: [number, number] | null;
  markTestid: string;
  paragraphClass?: string;
}

const HighlightedText = forwardRef<HTMLElement, Props>(function HighlightedText(
  { text, range, markTestid, paragraphClass = 'my-2' },
  markRef,
) {
  const a = range ? cpToUtf16(text, range[0]) : -1;
  const b = range ? cpToUtf16(text, range[1]) : -1;
  const paras: { start: number; body: string }[] = [];
  let pos = 0;
  for (const body of text.split('\n')) {
    paras.push({ start: pos, body });
    pos += body.length + 1;
  }
  let first = true;
  return (
    <>
      {paras.map((p, i) => {
        if (!p.body) return null;
        const end = p.start + p.body.length;
        const s = Math.max(a, p.start);
        const e = Math.min(b, end);
        if (!range || e <= s) {
          return (
            <p key={i} className={paragraphClass}>
              {p.body}
            </p>
          );
        }
        const isFirst = first;
        first = false;
        return (
          <p key={i} className={paragraphClass}>
            {p.body.slice(0, s - p.start)}
            <mark
              ref={isFirst ? (markRef as Ref<HTMLElement>) : undefined}
              data-testid={isFirst ? markTestid : undefined}
              className="mn-text-hl"
            >
              {p.body.slice(s - p.start, e - p.start)}
            </mark>
            {p.body.slice(e - p.start)}
          </p>
        );
      })}
    </>
  );
});

export default HighlightedText;
