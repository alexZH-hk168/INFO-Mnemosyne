// 规格：1-能力卡片组-单张卡片（home.card）
// 一张能力卡：封面插画（循环小动画）＋标题。是 <button>，aria-label“了解{标题}”；点击 / Enter 从原位放大成介绍弹窗。
import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import type { CardDef, CardId } from './cards';
import { Cover, SCENE_W } from './covers/Cover';

export const CARD_W = 294;
const COVER_W = CARD_W - 16;

export interface CardPose {
  x: number;
  y: number;
  rotate: number;
  zIndex: number;
}

export interface CardProps {
  card: CardDef;
  index: number;
  hovered: boolean;
  pose: CardPose;
  /** prefers-reduced-motion：只保留阴影与透明度变化 */
  reduced: boolean;
  /** 介绍弹窗从这张卡展开期间隐藏卡面（弹窗面板占据它的位置） */
  hidden: boolean;
  onHoverChange: (index: number | null) => void;
  onOpen: (id: CardId, el: HTMLButtonElement) => void;
}

export const Card = forwardRef<HTMLButtonElement, CardProps>(function Card(
  { card, index, hovered, pose, reduced, hidden, onHoverChange, onOpen },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      data-testid={`home.card:${card.id}`}
      data-hovered={hovered || undefined}
      aria-label={`了解${card.title}`}
      className={[
        'mn-card absolute left-1/2 top-0 rounded-panel bg-surface p-2 text-left outline-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-2',
      ].join(' ')}
      style={{ width: CARD_W, marginLeft: -CARD_W / 2, zIndex: pose.zIndex }}
      initial={false}
      animate={{ x: pose.x, y: pose.y, rotate: pose.rotate, opacity: hidden ? 0 : 1 }}
      transition={
        reduced
          ? { duration: 0, opacity: { duration: 0.15 } }
          : { type: 'spring', stiffness: 260, damping: 22, mass: 0.9, opacity: { duration: 0.14 } }
      }
      onPointerEnter={() => onHoverChange(index)}
      onPointerLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(index)}
      onBlur={() => onHoverChange(null)}
      onClick={(e) => onOpen(card.id, e.currentTarget)}
    >
      <div className="overflow-hidden rounded-card-sm" style={{ width: COVER_W, height: (COVER_W * 400) / SCENE_W }}>
        <Cover card={card} scale={COVER_W / SCENE_W} />
      </div>
      <div className="px-2.5 pb-1.5 pt-3 text-[15px] leading-5 text-ink">{card.title}</div>
    </motion.button>
  );
});
