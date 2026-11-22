// 封面分发：按卡片类型渲染 PaperCover / CodeCover / SlideCover。
// 封面按 540×400 的场景绘制：弹窗预览原尺寸显示，卡面按 scale 缩小后裁切（与 UI-01 卡面一致）。
import { memo, type CSSProperties } from 'react';
import type { CardDef } from '../cards';
import { CodeCover } from './CodeCover';
import { PaperCover } from './PaperCover';
import { SlideCover } from './SlideCover';

export const SCENE_W = 540;
export const SCENE_H = 400;

/** 封面较重（几十个文本节点＋SVG），props 稳定时跳过重渲染 */
export const Cover = memo(function Cover({ card, scale = 1 }: { card: CardDef; scale?: number }) {
  const c = card.cover;
  const inner =
    c.kind === 'paper' ? <PaperCover data={c} /> : c.kind === 'code' ? <CodeCover data={c} /> : <SlideCover data={c} />;
  if (scale === 1) return inner;
  const style: CSSProperties = { transform: `scale(${scale})`, transformOrigin: '0 0' };
  return (
    <div className="mn-scene-scaler" style={style}>
      {inner}
    </div>
  );
});
