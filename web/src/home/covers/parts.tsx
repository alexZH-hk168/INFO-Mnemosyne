// 封面共用小件：富文本、证据胶囊、浮动讲解卡。只负责排版，文字全部来自 cards.ts。
import type { CSSProperties } from 'react';
import type { CoverNote, Rich as RichT } from '../cards';

/**
 * 富文本。layer='bg' 时只画高亮底色（文字透明），用于论文封面的扫光层；
 * 默认画文字层，高亮片段只带下划线，底色由 bg 层提供。
 */
export function Rich({ value, layer }: { value: RichT; layer?: 'bg' }) {
  return (
    <>
      {value.map((s, i) => {
        const inner = s.sub ? <sub>{s.t}</sub> : s.sup ? <sup>{s.t}</sup> : s.t;
        const cls = layer === 'bg' ? (s.hl ? 'mn-hl-bg' : 'mn-ghost') : s.hl ? 'mn-hl-fg' : undefined;
        return (
          <span key={i} className={cls}>
            {inner}
          </span>
        );
      })}
    </>
  );
}

export function Chip({ label, tone }: CoverNote['chip']) {
  return <span className={`mn-chip ${tone === 'web' ? 'mn-chip-web' : 'mn-chip-material'}`}>{label}</span>;
}

/** 封面右侧的讲解浮卡（UI-01～03 里的“为什么要除以 √d_k？”“第 7 行：…”） */
export function NoteCard({
  note,
  className = '',
  style,
}: {
  note: CoverNote;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`mn-note ${className}`} style={style}>
      <div className="mn-note-title">
        <Rich value={note.title} />
      </div>
      <div className="mn-note-body">
        {note.body} <Chip {...note.chip} />
      </div>
    </div>
  );
}
