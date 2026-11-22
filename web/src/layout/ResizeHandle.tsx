// 规格：1-外壳-分栏拖拽条（shell.resize-handle）
// index 0：项目|文件，调项目栏；1：文件|中间，调文件栏；2：中间|右栏，调右栏（右栏在拖拽条右侧，方向相反）。
// 中间对话栏是弹性栏，吸收差值；拖动时不让它小于 480 px（state.md 对话栏 ≥ 480）。
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { sizeLimits, useLayout, type PanelIndex } from '../store/layout';

export const CHAT_MIN = 480;
const KEY_STEP = 16;
const ARIA: Record<number, string> = { 0: '调整项目栏宽度', 1: '调整文件栏宽度', 2: '调整右栏宽度' };

interface Props {
  index: 0 | 1 | 2;
  /** 被调整那一栏当前的实际宽度（px） */
  width: number;
  /** 这一栏还能变宽多少 px（保证对话栏不小于 480；由 FourPane 按布局算出） */
  getGrowRoom: () => number;
}

export default function ResizeHandle({ index, width, getGrowRoom }: Props) {
  const panel: PanelIndex = index === 2 ? 3 : index;
  const sign = index === 2 ? -1 : 1;
  const setSize = useLayout((s) => s.setSize);
  const resetSize = useLayout((s) => s.resetSize);
  const start = useRef<{ x: number; w: number; room: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [min, max] = sizeLimits(panel);

  /** 目标宽度：增大时不超过中间区剩余空间，其余限制由 setSize 夹紧 */
  const apply = (from: number, room: number, next: number) => {
    const capped = next > from ? Math.min(next, from + room) : next;
    setSize(panel, capped);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    start.current = { x: e.clientX, w: width, room: getGrowRoom() };
    setDragging(true);
    document.body.classList.add('mn-resizing');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    apply(s.w, s.room, s.w + sign * (e.clientX - s.x));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    document.body.classList.remove('mn-resizing');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP) * sign;
    apply(width, getGrowRoom(), width + delta);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ARIA[index]}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={Number.isFinite(max) ? max : undefined}
      tabIndex={0}
      data-testid={`shell.resize-handle:${index}`}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => resetSize(panel)}
      onKeyDown={onKeyDown}
      className="group relative w-2 flex-none cursor-col-resize touch-none outline-none"
    >
      <span
        aria-hidden="true"
        className={`absolute bottom-2.5 left-[3px] top-2.5 w-[2px] rounded-[2px] bg-handle transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
          dragging ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
