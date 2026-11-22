// 规格：1-主页-能力卡片组（home.card-fan）
// 三张卡扇形叠放：左“论文阅读”、中“代码解析”、右“课件学习”。左右两张各转 ±8°，中间一张略低。
// 悬停（或键盘聚焦）某张：该卡抬起 12 px 并转正，另两张向两侧让开 24 px（framer-motion spring，动效参考 ClawsGO）。
// prefers-reduced-motion：不做位移，只保留阴影变化。只用组件内部 state。
import { useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Card, type CardPose } from './Card';
import { FAN_HEIGHT, FAN_SPREAD, fanPose } from './fan';
import { CARDS, type CardId } from './cards';

export interface FanCardsProps {
  /** 弹窗从这张卡展开时隐藏它 */
  hiddenCard: CardId | null;
  onOpen: (id: CardId, el: HTMLButtonElement, pose: CardPose) => void;
  registerCard: (id: CardId, el: HTMLButtonElement | null) => void;
}

export function FanCards({ hiddenCard, onOpen, registerCard }: FanCardsProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const reduced = useReducedMotion() ?? false;
  const motionHover = reduced || hiddenCard !== null ? null : hovered;

  return (
    <div
      data-testid="home.card-fan"
      role="group"
      aria-label="能力卡片"
      className="mn-fan relative"
      style={{ width: FAN_SPREAD * 2 + 340, height: FAN_HEIGHT }}
    >
      {CARDS.map((card, i) => {
        const pose = fanPose(i, motionHover);
        return (
          <Card
            key={card.id}
            ref={(el) => registerCard(card.id, el)}
            card={card}
            index={i}
            hovered={hiddenCard === null && hovered === i}
            pose={pose}
            reduced={reduced}
            hidden={hiddenCard === card.id}
            onHoverChange={setHovered}
            onOpen={(id, el) => {
              setHovered(null);
              onOpen(id, el, pose);
            }}
          />
        );
      })}
    </div>
  );
}
