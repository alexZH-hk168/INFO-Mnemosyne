// 规格：1-主页-能力卡片组（home.card-fan）「状态」——扇形位姿：左右两张各转 ±8°、中间一张略低；悬停抬起 12 px 并转正，另两张让开 24 px。
import type { CardPose } from './Card';

export const FAN_SPREAD = 246;
export const FAN_ROTATE = 8;
export const FAN_MID_DROP = 26;
export const FAN_HEIGHT = 300;

/** 第 i 张卡在悬停 h（null=无）时的位姿 */
export function fanPose(i: number, h: number | null): CardPose {
  const side = i - 1;
  const base: CardPose = {
    x: side * FAN_SPREAD,
    y: side === 0 ? FAN_MID_DROP : 0,
    rotate: side * FAN_ROTATE,
    zIndex: side === 0 ? 2 : 1,
  };
  if (h === null) return base;
  if (i === h) return { ...base, y: base.y - 12, rotate: 0, zIndex: 3 };
  return { ...base, x: base.x + Math.sign(i - h) * 24 };
}
