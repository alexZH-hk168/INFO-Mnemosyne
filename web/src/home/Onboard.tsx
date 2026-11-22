// 规格：1-新建对话-主页（home.onboard）
// 没有打开对话时中间区显示的主页：宋体大标题“今天要学习什么？”、主页版输入框、扇形叠放的三张能力卡片。
// 不显示记忆提示；主页本身不发请求。窗口高度 < 760 时卡片缩到 0.85。
// 在四栏外壳里只有中间区宽度（最窄 480）：按自身宽度收紧卡片间距、仍放不下再缩放（fan.ts fanFit）。
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useUI } from '../store/ui';
import type { CardPose } from './Card';
import { CardModal, type CardOrigin, type CloseReason } from './CardModal';
import { CARD_IDS, getCard, isCardId, neighborCard, type CardId } from './cards';
import { FanCards } from './FanCards';
import { FAN_SPREAD, fanFit, fanPose, type FanFit } from './fan';
import { setMainDraftText } from './draft';
import { HomeComposerShell } from './HomeComposerShell';
import './home.css';

/** 主页左右内边距（px-6） */
const PAD_X = 24;
const DESIGN_FIT: FanFit = { spread: FAN_SPREAD, widthScale: 1, heightScale: 1, scale: 1 };

/** 监听主页宽度与窗口高度，算出扇面间距与缩放；量不到宽度（如 jsdom）时用设计尺寸 */
function useFanFit(ref: RefObject<HTMLElement>): FanFit {
  const [fit, setFit] = useState<FanFit>(DESIGN_FIT);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const next = w > 0 ? fanFit(w - PAD_X * 2, window.innerHeight) : DESIGN_FIT;
      setFit((prev) => (prev.spread === next.spread && Math.abs(prev.scale - next.scale) < 0.002 ? prev : next));
    };
    update();
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [ref]);
  return fit;
}

export function Onboard() {
  const modal = useUI((s) => s.modal);
  const openModal = useUI((s) => s.openModal);
  const closeModal = useUI((s) => s.closeModal);

  const rootRef = useRef<HTMLDivElement>(null);
  const fit = useFanFit(rootRef);
  const cardEls = useRef(new Map<CardId, HTMLButtonElement>());
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** 打开弹窗的那张卡：弹窗期间隐藏，关闭时面板收回到它、焦点回到它 */
  const [origin, setOrigin] = useState<{ id: CardId; openRotate: number } | null>(null);
  /** 收回动画过半后原卡片提前淡入 */
  const [revealed, setRevealed] = useState(false);
  const [dir, setDir] = useState<1 | -1>(1);

  const rawCard = modal?.kind === 'card-intro' ? modal.props?.card : undefined;
  const current: CardId | null = isCardId(rawCard) ? rawCard : null;

  const registerCard = useCallback((id: CardId, el: HTMLButtonElement | null) => {
    if (el) cardEls.current.set(id, el);
    else cardEls.current.delete(id);
  }, []);

  const handleOpen = (id: CardId, _el: HTMLButtonElement, pose: CardPose) => {
    setOrigin({ id, openRotate: pose.rotate });
    setRevealed(false);
    setDir(1);
    openModal('card-intro', { card: id });
  };

  // 弹窗也可能由别处打开（没经过卡片点击）：此时以当前卡片为原卡片
  const originId: CardId | null = origin?.id ?? current;

  const getOrigin = (): CardOrigin | null => {
    if (!originId) return null;
    const rest = fanPose(CARD_IDS.indexOf(originId), null).rotate;
    return {
      el: cardEls.current.get(originId) ?? null,
      openRotate: origin?.openRotate ?? rest,
      restRotate: rest,
    };
  };

  const handleNav = (d: 1 | -1) => {
    if (!current) return;
    setDir(d);
    openModal('card-intro', { card: neighborCard(current, d) });
  };

  const handleClosed = (reason: CloseReason) => {
    const back = originId;
    const shown = current;
    closeModal();
    setOrigin(null);
    setRevealed(false);
    if (reason === 'try' && shown) {
      // 规格 2-卡片介绍弹窗-试一试按钮：关闭弹窗；输入框预填示例问题（不自动发送）。
      // 已在主页（新对话状态），无需另建对话。TODO(U8)：示例材料定了以后在这里上传
      // web/public/samples/<card>/ 到 POST /api/projects/{pid}/documents（同 sha256 跳过），上传中按钮转圈、弹窗不关。
      setMainDraftText(getCard(shown).sampleQuestion);
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    if (back) requestAnimationFrame(() => cardEls.current.get(back)?.focus());
  };

  return (
    <div
      ref={rootRef}
      data-testid="home.onboard"
      data-fan-scale={fit.scale.toFixed(3)}
      className="mn-onboard flex h-full w-full flex-col items-center overflow-y-auto overflow-x-hidden bg-canvas px-6"
    >
      <div className="min-h-6 flex-[0.85]" />
      <h1 className="text-center font-serif text-[40px] font-semibold leading-[1.3] tracking-[0.02em] text-ink">
        今天要学习什么？
      </h1>
      <div className="mt-9 w-full max-w-[740px]">
        <HomeComposerShell ref={composerRef} />
      </div>
      {/* 两侧卡片转 8° 后外角会高出卡组顶边约 20 px（随缩放），留出这部分再加 48 px 间距 */}
      <div className="shrink-0" style={{ marginTop: Math.round(48 + 20 * fit.scale) }}>
        <FanCards
          hiddenCard={current && !revealed ? originId : null}
          onOpen={handleOpen}
          registerCard={registerCard}
          fit={fit}
        />
      </div>
      <div className="min-h-6 flex-[1.15]" />
      {current && (
        <CardModal
          card={current}
          dir={dir}
          getOrigin={getOrigin}
          onNav={handleNav}
          onReveal={() => setRevealed(true)}
          onClosed={handleClosed}
        />
      )}
    </div>
  );
}
