// 规格：2-能力卡片-卡片介绍弹窗（home.card-modal）
//      2-卡片介绍弹窗-试一试按钮（home.card-try）
//      2-卡片介绍弹窗-知道了按钮（home.card-dismiss）
// 大弹窗：左侧标题与说明、右侧大预览，下面三行能力说明，底部左侧示例出处、右侧“试一试”“知道了”。
// 打开：面板从原卡片位置放大（共享元素过渡，FLIP 只动 transform），背后主页毛玻璃；关闭：250 ms 沿原路径收回。
// ←/→ 循环切换三张；Esc / 遮罩 / 右上 × 同“知道了”；焦点锁在弹窗内，关闭后回到原卡片。
// prefers-reduced-motion：打开只做透明度渐变，关闭直接消失。
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion';
import { BRAND, getCard, type CardId } from './cards';
import { Cover } from './covers/Cover';
import { Rich } from './covers/parts';
import { Icon } from './icons';

export type CloseReason = 'dismiss' | 'try';

/** 原卡片的位置信息：元素、当时的旋转角（打开时）与静止旋转角（收回时） */
export interface CardOrigin {
  el: HTMLElement | null;
  openRotate: number;
  restRotate: number;
}

export interface CardModalProps {
  card: CardId;
  /** 切换方向，用于内容左右滑入：1=下一张，-1=上一张 */
  dir: 1 | -1;
  getOrigin: () => CardOrigin | null;
  onNav: (dir: 1 | -1) => void;
  /** 收回动画过半时调用，让原卡片提前淡入，与面板衔接 */
  onReveal: () => void;
  onClosed: (reason: CloseReason) => void;
}

const CLOSE_MS = 250;

interface Flip {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
}

/** 面板布局位置（不含 transform）→ 原卡片位置的变换 */
function measureFlip(panel: HTMLElement, origin: CardOrigin | null, rotate: 'open' | 'rest'): Flip | null {
  const el = origin?.el;
  if (!el || !el.isConnected) return null;
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  if (!pw || !ph) return null;
  // 面板的定位容器是铺满视口的 fixed 层，offsetLeft/Top 即视口坐标
  const pcx = panel.offsetLeft + pw / 2;
  const pcy = panel.offsetTop + ph / 2;
  const r = el.getBoundingClientRect(); // 旋转/缩放后的外接框，中心即卡片中心
  const fan = el.parentElement;
  const fanScale = fan && fan.offsetWidth ? fan.getBoundingClientRect().width / fan.offsetWidth : 1;
  return {
    x: r.left + r.width / 2 - pcx,
    y: r.top + r.height / 2 - pcy,
    scaleX: (el.offsetWidth * fanScale) / pw,
    scaleY: (el.offsetHeight * fanScale) / ph,
    rotate: rotate === 'open' ? origin.openRotate : origin.restRotate,
  };
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function CardModal({ card, dir, getOrigin, onNav, onReveal, onClosed }: CardModalProps) {
  const reduced = useReducedMotion() ?? false;
  const def = getCard(card);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  // 最新回调放进 ref，键盘监听只挂一次
  const cb = useRef({ onNav, onReveal, onClosed, getOrigin, reduced });
  cb.current = { onNav, onReveal, onClosed, getOrigin, reduced };

  // 打开：FLIP 从原卡片放大
  useLayoutEffect(() => {
    const panel = panelRef.current!;
    const content = contentRef.current!;
    const scrim = scrimRef.current!;
    panel.focus({ preventScroll: true });
    const { reduced: rm, getOrigin: go } = cb.current;
    const flip = rm ? null : measureFlip(panel, go(), 'open');
    if (!flip) {
      animate(scrim, { opacity: [0, 1] }, { duration: 0.18 });
      animate(panel, { opacity: [0, 1] }, { duration: 0.18 });
      animate(content, { opacity: [0, 1] }, { duration: 0.18 });
      return;
    }
    animate(scrim, { opacity: [0, 1] }, { duration: 0.3, ease: 'easeOut' });
    animate(panel, { opacity: [0, 1] }, { duration: 0.06 });
    animate(
      panel,
      {
        x: [flip.x, 0],
        y: [flip.y, 0],
        scaleX: [flip.scaleX, 1],
        scaleY: [flip.scaleY, 1],
        rotate: [flip.rotate, 0],
      },
      { type: 'spring', stiffness: 240, damping: 27, mass: 0.9 },
    );
    animate(content, { opacity: [0, 1] }, { duration: 0.22, delay: 0.12, ease: 'easeOut' });
  }, []);

  const close = (reason: CloseReason) => {
    if (closingRef.current) return;
    closingRef.current = true;
    panelRef.current?.parentElement?.parentElement?.setAttribute('data-closing', 'true');
    const panel = panelRef.current;
    const { reduced: rm, getOrigin: go, onReveal: reveal, onClosed: done } = cb.current;
    if (rm || !panel) {
      // 减少动效：直接消失
      reveal();
      done(reason);
      return;
    }
    const flip = measureFlip(panel, go(), 'rest');
    const anims = [
      animate(contentRef.current!, { opacity: 0 }, { duration: 0.1 }),
      animate(scrimRef.current!, { opacity: 0 }, { duration: CLOSE_MS / 1000, ease: 'easeIn' }),
      flip
        ? animate(
            panel,
            { x: flip.x, y: flip.y, scaleX: flip.scaleX, scaleY: flip.scaleY, rotate: flip.rotate },
            { duration: CLOSE_MS / 1000, ease: [0.4, 0, 0.2, 1] },
          )
        : animate(panel, { opacity: 0 }, { duration: CLOSE_MS / 1000 }),
    ];
    if (flip) animate(panel, { opacity: [1, 1, 0] }, { duration: CLOSE_MS / 1000, times: [0, 0.72, 1] });
    const t = window.setTimeout(reveal, CLOSE_MS * 0.6);
    Promise.all(anims).then(() => {
      window.clearTimeout(t);
      reveal();
      done(reason);
    });
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // 键盘：Esc 关闭，←/→ 切换，Tab 锁在弹窗内
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel || closingRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current('dismiss');
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        cb.current.onNav(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === 'Tab') {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        const inside = active instanceof Node && panel.contains(active);
        if (e.shiftKey && (active === first || active === panel || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !inside)) {
          e.preventDefault();
          first.focus();
        } else if (!e.shiftKey && active === panel) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const slide = reduced ? 0 : 28;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        ref={scrimRef}
        data-testid="home.card-modal-scrim"
        className="mn-scrim absolute inset-0"
        style={{ opacity: 0 }}
        onClick={() => close('dismiss')}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${BRAND} · ${def.title}`}
          tabIndex={-1}
          data-testid="home.card-modal"
          data-card={card}
          className="pointer-events-auto relative flex max-h-full w-[1060px] max-w-full flex-col overflow-hidden mn-modal-panel rounded-[22px] bg-surface outline-none"
          style={{ opacity: 0, transformOrigin: '50% 50%' }}
        >
          <button
            type="button"
            data-testid="home.card-modal-close"
            aria-label="关闭"
            className="absolute right-[30px] top-[26px] z-10 grid h-9 w-9 place-items-center rounded-btn text-ink-2 outline-none hover:bg-sel focus-visible:ring-2 focus-visible:ring-ink-2"
            onClick={() => close('dismiss')}
          >
            <Icon name="x" size={20} />
          </button>

          <div ref={contentRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ opacity: 0 }}>
            <div className="grid px-[52px] pt-[44px]">
              <AnimatePresence initial={false} custom={dir}>
                <motion.div
                  key={card}
                  custom={dir}
                  className="[grid-area:1/1]"
                  initial={{ opacity: 0, x: dir * slide }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -dir * slide }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                >
                  <div className="text-[13.5px] text-ink-2">
                    {BRAND} · {def.title}
                  </div>
                  <div className="mt-[30px] grid grid-cols-[1fr_540px] items-center gap-[48px]">
                    <div>
                      <h2 className="font-serif text-[31px] font-semibold leading-[1.5] text-ink">
                        {def.headline.map((l, i) => (
                          <span key={i} className="block">
                            {l}
                          </span>
                        ))}
                      </h2>
                      <p className="mt-5 max-w-[380px] text-[14.5px] leading-[2.1] text-ink-2">{def.description}</p>
                    </div>
                    <div className="relative h-[400px] w-[540px] overflow-hidden rounded-[16px] border border-line-2">
                      <Cover card={def} />
                      <div
                        className="mn-ov"
                        style={def.cover.kind === 'slides' ? { left: 22, top: 318 } : { left: 22, bottom: 18 }}
                      >
                        <Icon name={def.overlay.icon} size={15} />
                        <b>{def.overlay.label}</b>
                        <span>
                          <Rich value={def.overlay.text} />
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-[26px]">
                    {def.rows.map((r, i) => (
                      <div
                        key={r.title}
                        className={`grid h-[59px] grid-cols-[250px_1fr] items-center ${i < def.rows.length - 1 ? 'border-b border-line' : ''}`}
                      >
                        <div className="font-serif text-[17.5px] font-semibold text-ink">{r.title}</div>
                        <div className="text-[14px] text-ink-2">{r.desc}</div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-4 px-[52px] pb-[32px] pt-[16px]">
              <div className="grid min-w-0 flex-1">
                <AnimatePresence initial={false}>
                  <motion.p
                    key={card}
                    className="text-[12.5px] text-muted [grid-area:1/1]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {def.source}
                  </motion.p>
                </AnimatePresence>
              </div>
              <button
                type="button"
                data-testid="home.card-try"
                className="h-[42px] shrink-0 rounded-pill bg-panel-2 px-[22px] text-[14.5px] text-ink-2 outline-none transition-colors hover:bg-sel focus-visible:ring-2 focus-visible:ring-ink-2 focus-visible:ring-offset-2"
                onClick={() => close('try')}
              >
                试一试
              </button>
              <button
                type="button"
                data-testid="home.card-dismiss"
                className="h-[42px] shrink-0 rounded-pill bg-ink px-[22px] text-[14.5px] text-surface outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ink-2 focus-visible:ring-offset-2"
                onClick={() => close('dismiss')}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
