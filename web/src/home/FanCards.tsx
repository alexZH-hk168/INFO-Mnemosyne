// 规格：1-主页-能力卡片组（home.card-fan）
// 三张卡扇形叠放：左“论文阅读”、中“代码解析”、右“课件学习”。左右两张各转 ±8°，中间一张略低。
// 悬停（或键盘聚焦）某张：该卡抬起 12 px 并转正，另两张向两侧让开 24 px（framer-motion spring，动效参考 ClawsGO）。
// prefers-reduced-motion：不做位移，只保留阴影变化。只用组件内部 state。
// 自适应：外层占位盒按缩放后的视觉尺寸参与布局，扇面绝对定位居中再整体缩放，不会溢出中间区被两侧栏盖住。
import { useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Card, type CardPose } from './Card';
import { FAN_HEIGHT, FAN_SPREAD, fanBoxWidth, fanPose, type FanFit } from './fan';
import { CARDS, type CardId } from './cards';

export interface FanCardsProps {
  /** 弹窗从这张卡展开时隐藏它 */
  hiddenCard: CardId | null;
  onOpen: (id: CardId, el: HTMLButtonElement, pose: CardPose) => void;
  registerCard: (id: CardId, el: HTMLButtonElement | null) => void;
  /** 间距与缩放（Onboard 按中间区宽度与窗口高度计算）；缺省为设计尺寸 */
  fit?: Pick<FanFit, 'spread' | 'scale'>;
}

export function FanCards({ hiddenCard, onOpen, registerCard, fit }: FanCardsProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const reduced = useReducedMotion() ?? false;
  const motionHover = reduced || hiddenCard !== null ? null : hovered;
  const spread = fit?.spread ?? FAN_SPREAD;
  const scale = fit?.scale ?? 1;
  const boxW = fanBoxWidth(spread);

  return (
    <div
      data-testid="home.card-fan-frame"
      className="relative"
      style={{ width: Math.ceil(boxW * scale), height: Math.ceil(FAN_HEIGHT * scale) }}
    >
      <div
        data-testid="home.card-fan"
        data-spread={spread}
        role="group"
        aria-label="能力卡片"
        className="mn-fan absolute left-1/2 top-0"
        style={{
          width: boxW,
          height: FAN_HEIGHT,
          marginLeft: -boxW / 2,
          transform: scale === 1 ? undefined : `scale(${scale})`,
        }}
      >
        {CARDS.map((card, i) => {
          const pose = fanPose(i, motionHover, spread);
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
    </div>
  );
}
