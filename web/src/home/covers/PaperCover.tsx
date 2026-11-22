// 规格：1-能力卡片组-单张卡片（home.card）「交互细则」——封面组件 covers/PaperCover.tsx，SVG/HTML 重画，不拷概念图代码。
// 论文页示意排版：标题、作者、3.2.1 小节、公式、被高亮的段落、算子标签，右侧讲解浮卡。
// 循环动画：高亮条逐行从左向右扫过（周期 5 s，CSS transform，见 home.css .mn-hl-bar）。
import type { CSSProperties } from 'react';
import type { PaperCover as PaperData } from '../cards';
import { NoteCard, Rich } from './parts';

export function PaperCover({ data }: { data: PaperData }) {
  return (
    <div className="mn-scene mn-scene-paper" aria-hidden="true">
      <div className="mn-paper">
        <div className="mn-paper-title">{data.title}</div>
        <div className="mn-paper-authors">{data.authors}</div>
        <div className="mn-paper-section">{data.section}</div>
        {data.intro.map((line, i) => (
          <div key={i} className="mn-paper-line">
            <Rich value={line} />
          </div>
        ))}
        <div className="mn-paper-formula">
          <Rich value={data.formula} />
        </div>
        {data.body.map((line, i) => (
          <div key={i} className="mn-paper-line" style={{ '--mn-line': i } as CSSProperties}>
            {line.some((s) => s.hl) && (
              <div className="mn-sweep-win mn-anim">
                <div className="mn-sweep-inner mn-anim">
                  <Rich value={line} layer="bg" />
                </div>
              </div>
            )}
            <div className="relative">
              <Rich value={line} />
            </div>
          </div>
        ))}
        <div className="mn-paper-ops">
          {data.ops.map((op, i) => (
            <span key={i} className={op.tone === 'mask' ? 'mn-op mn-op-mask' : 'mn-op'}>
              {op.label}
            </span>
          ))}
        </div>
      </div>
      <NoteCard note={data.note} className="mn-paper-note" />
    </div>
  );
}
