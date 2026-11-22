// 规格：1-主页-能力卡片组（home.card-fan）「状态」——扇形位姿：左右两张各转 ±8°、中间一张略低；悬停抬起 12 px 并转正，另两张让开 24 px。
// 集成到四栏后主页只有中间区宽度：扇面放不下时先收紧卡片间距（最紧 FAN_SPREAD_MIN），仍放不下再整体缩放（fanFit）。
import type { CardPose } from './Card';

export const FAN_SPREAD = 246;
export const FAN_SPREAD_MIN = 150;
export const FAN_ROTATE = 8;
export const FAN_MID_DROP = 26;
export const FAN_HEIGHT = 300;
export const FAN_PUSH = 24;
/** 窗口高度 < 760 时卡片缩到 0.85（规格 1-新建对话-主页「状态」） */
export const SHORT_WINDOW = 760;
export const SHORT_SCALE = 0.85;

/** 单侧最外沿到中心的距离之外的固定部分：半张卡 147 + 悬停让开 24 + 旋转 8° 后外接框多出的约 18 */
const EDGE = 147 + FAN_PUSH + 18;

/** 扇面在间距 spread 下需要的视觉宽度（含悬停让开与旋转） */
export const fanNeededWidth = (spread: number) => 2 * (spread + EDGE);

/** 扇面布局盒的宽度（未缩放） */
export const fanBoxWidth = (spread: number) => 2 * spread + 340;

export interface FanFit {
  spread: number;
  /** 宽度方向的缩放（≤ 1） */
  widthScale: number;
  /** 高度方向的缩放：窗口矮于 760 时 0.85 */
  heightScale: number;
  /** 实际应用的缩放 = min(widthScale, 1) × heightScale */
  scale: number;
}

/** 按可用宽度与窗口高度决定卡片间距与缩放 */
export function fanFit(availWidth: number, windowHeight: number): FanFit {
  const heightScale = windowHeight < SHORT_WINDOW ? SHORT_SCALE : 1;
  // 高度缩放后同样的可用宽度能容纳更宽的扇面
  const w = availWidth / heightScale;
  let spread = FAN_SPREAD;
  if (w < fanNeededWidth(FAN_SPREAD)) spread = Math.max(FAN_SPREAD_MIN, Math.floor((w - 2 * EDGE) / 2));
  const widthScale = Math.min(1, w / fanNeededWidth(spread));
  return { spread, widthScale, heightScale, scale: widthScale * heightScale };
}

/** 第 i 张卡在悬停 h（null=无）时的位姿 */
export function fanPose(i: number, h: number | null, spread = FAN_SPREAD): CardPose {
  const side = i - 1;
  const base: CardPose = {
    x: side * spread,
    y: side === 0 ? FAN_MID_DROP : 0,
    rotate: side * FAN_ROTATE,
    zIndex: side === 0 ? 2 : 1,
  };
  if (h === null) return base;
  if (i === h) return { ...base, y: base.y - 12, rotate: 0, zIndex: 3 };
  return { ...base, x: base.x + Math.sign(i - h) * FAN_PUSH };
}
