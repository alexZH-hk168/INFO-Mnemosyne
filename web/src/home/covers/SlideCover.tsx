// 规格：1-能力卡片组-单张卡片（home.card）「交互细则」——封面组件 covers/SlideCover.tsx，SVG/HTML 重画。
// 课件页示意：反向传播计算图（灰色前向箭头、红色虚线反向梯度）、链式法则公式、右下小测卡。
// 循环动画：梯度箭头从 L 往 w 依次亮起，虚线沿反向流动（周期 5 s，见 home.css .mn-grad）。
import { useId, type CSSProperties } from 'react';
import type { SlideCover as SlideData } from '../cards';

/** 节点坐标（SVG viewBox 0 0 440 172） */
const N = {
  x: { cx: 36, cy: 44, r: 15 },
  w: { cx: 36, cy: 124, r: 15 },
  mul: { cx: 140, cy: 84, r: 19 },
  b: { cx: 140, cy: 152, r: 13 },
  add: { cx: 244, cy: 84, r: 19 },
  sig: { cx: 340, cy: 84, r: 19 },
  loss: { cx: 420, cy: 84, r: 17 },
} as const;

/** 前向箭头（从节点边缘到节点边缘，已按半径算好） */
const FORWARD = [
  'M50 49.4 L119.5 76.1',
  'M50 118.6 L119.5 91.9',
  'M159 84 L221 84',
  'M150.8 144.7 L225.8 96.3',
  'M263 84 L317 84',
  'M359 84 L399 84',
];

/** 反向梯度弧线：从右侧节点画向左侧节点，按亮起顺序排列（L→σ, σ→+, +→×, ×→w） */
const BACKWARD: { d: string; lx: number; ly: number; key: 'la' | 'az' | 'zu' | 'uw' }[] = [
  { d: 'M410 66 Q382 36 354 64', lx: 382, ly: 32, key: 'la' },
  { d: 'M326 64 Q292 36 258 64', lx: 292, ly: 32, key: 'az' },
  { d: 'M230 64 Q192 36 156 64', lx: 192, ly: 32, key: 'zu' },
  { d: 'M124 96 Q96 124 54 128', lx: 82, ly: 152, key: 'uw' },
];

export function SlideCover({ data }: { data: SlideData }) {
  const uid = useId().replace(/:/g, '');
  const fwd = `mn-fwd-${uid}`;
  const back = `mn-back-${uid}`;
  const node = (k: keyof typeof N, label: string, dark = false) => (
    <g key={k}>
      <circle
        cx={N[k].cx}
        cy={N[k].cy}
        r={N[k].r}
        className={dark ? 'mn-node-dark' : k === 'x' || k === 'w' || k === 'b' ? 'mn-node-in' : 'mn-node'}
      />
      <text x={N[k].cx} y={N[k].cy + 4} textAnchor="middle" className={dark ? 'mn-node-label-dark' : 'mn-node-label'}>
        {label}
      </text>
    </g>
  );
  return (
    <div className="mn-scene mn-scene-slides" aria-hidden="true">
      <div className="mn-slide">
        <div className="mn-slide-head">
          <span>{data.deck}</span>
          <span>{data.page}</span>
        </div>
        <div className="mn-slide-title">{data.title}</div>
        <svg className="mn-slide-graph" viewBox="0 0 440 172" width="440" height="172">
          <defs>
            <marker id={fwd} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 Z" className="mn-arrow-fwd" />
            </marker>
            <marker id={back} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 Z" className="mn-arrow-back" />
            </marker>
          </defs>
          {FORWARD.map((d, i) => (
            <path key={i} d={d} className="mn-edge" markerEnd={`url(#${fwd})`} />
          ))}
          {node('x', data.nodes.x)}
          {node('w', data.nodes.w)}
          {node('mul', data.nodes.mul)}
          {node('b', data.nodes.b)}
          {node('add', data.nodes.add)}
          {node('sig', data.nodes.sig)}
          {node('loss', data.nodes.loss, true)}
          {BACKWARD.map((g, i) => (
            <g key={g.key} className="mn-grad mn-anim" style={{ '--mn-i': i } as CSSProperties}>
              <path d={g.d} className="mn-grad-path mn-anim" markerEnd={`url(#${back})`} />
              <text x={g.lx} y={g.ly} textAnchor="middle" className="mn-grad-label">
                {data.grads[g.key]}
              </text>
            </g>
          ))}
        </svg>
        <div className="mn-slide-formula">{data.formula}</div>
      </div>
      <div className="mn-quiz">
        <div className="mn-quiz-meta">{data.quiz.meta}</div>
        <div className="mn-quiz-q">{data.quiz.question}</div>
        <div className="mn-quiz-opts">
          {data.quiz.options.map((o, i) => (
            <span key={i} className={i === data.quiz.correct ? 'mn-quiz-opt mn-quiz-ok' : 'mn-quiz-opt'}>
              {o}
              {i === data.quiz.correct && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
