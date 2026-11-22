// 规格：1-能力卡片组-单张卡片（home.card）「交互细则」——封面组件 covers/CodeCover.tsx，SVG/HTML 重画。
// 只读代码预览示意：文件头、调用链面包屑、带行号的代码、讲解浮卡。
// 循环动画：高亮条从 scanFrom 行逐行下移，停在 focusLine 行（周期 5 s，见 home.css .mn-code-bar）。
import type { CSSProperties } from 'react';
import type { CodeCover as CodeData } from '../cards';
import { NoteCard } from './parts';

const TOK_CLASS = { kw: 'mn-tok-kw', fn: 'mn-tok-fn', str: 'mn-tok-str', plain: '' } as const;

export function CodeCover({ data }: { data: CodeData }) {
  const vars = {
    '--mn-focus': data.focusLine - 1,
    '--mn-scan': data.focusLine - data.scanFrom,
  } as CSSProperties;
  return (
    <div className="mn-scene mn-scene-code" aria-hidden="true">
      <div className="mn-code-head">
        <span className="mn-code-badge">{data.badge}</span>
        <span className="mn-code-file">{data.file}</span>
        <span className="mn-code-ro">{data.readonly}</span>
      </div>
      <div className="mn-code-crumbs">
        {data.crumbs.map((c, i) => (
          <span key={i} className="mn-code-crumb">
            {i > 0 && <span className="mn-code-sep">›</span>}
            <span className={i === data.crumbs.length - 1 ? 'mn-code-crumb-cur' : ''}>{c}</span>
          </span>
        ))}
      </div>
      <div className="mn-code-body" style={vars}>
        <div className="mn-code-bar mn-anim" />
        {data.lines.map((toks, i) => (
          <div key={i} className="mn-code-line">
            <span className="mn-code-no">{i + 1}</span>
            <span className="mn-code-src">
              {toks.map((tk, j) => (
                <span key={j} className={TOK_CLASS[tk.k]}>
                  {tk.t}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <NoteCard note={data.note} className="mn-code-note mn-anim" />
    </div>
  );
}
