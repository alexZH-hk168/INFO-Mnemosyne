// 规格：2-证据胶囊-原句浮层（chat.evidence-hover）
// 悬停胶囊 300 ms 后出现：来源标题、位置、原句（最多 4 行）；优先显示在胶囊上方（floating-ui）。
// 本地没有证据数据时读 ['evidence', eid]，加载中显示一行骨架。点击浮层同点击胶囊；移出 150 ms 关闭。
// 概念图缺口：样式参考 UI-02 预览里的浮签卡片。
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react-dom';
import { useEffect } from 'react';
import { useEvidence as useEvidenceQuery } from '../api/queries';
import { labelNumber } from '../lib/citations';
import { chipTone, longPosition, TONE_CLASS } from '../lib/evidenceDisplay';
import { useChat } from '../store/chat';
import { useEvidence } from '../store/evidence';
import { getHoverMessageId, hoverKeep, hoverLeave, openEvidence } from './EvidenceChip';

export default function EvidenceHover() {
  const hover = useEvidence((s) => s.hover);
  const local = useChat((s) => (hover ? s.streaming?.evidence.find((e) => e.id === hover.eid) : undefined));
  const remote = useEvidenceQuery(hover && !local ? hover.eid : null);
  const ev = local ?? remote.data;

  const { refs, floatingStyles } = useFloating({
    placement: 'top-start',
    strategy: 'fixed',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!hover) return;
    const { x, y, width, height } = hover.rect;
    refs.setReference({
      getBoundingClientRect: () => ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }),
    });
  }, [hover, refs]);

  // 滚动时关闭（定位基于打开那一刻的位置）
  useEffect(() => {
    if (!hover) return;
    const close = () => useEvidence.setState({ hover: null });
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [hover]);

  if (!hover) return null;
  const mid = getHoverMessageId();
  const label = ev?.label ? `证据 ${labelNumber(ev.label)}` : '证据';
  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      role="button"
      tabIndex={-1}
      data-testid="chat.evidence-hover"
      data-eid={hover.eid}
      onMouseEnter={hoverKeep}
      onMouseLeave={hoverLeave}
      onClick={() => mid && openEvidence(hover.eid, mid, ev)}
      className="z-40 w-[320px] cursor-pointer rounded-card border border-line bg-surface px-3.5 py-3 text-left shadow-[var(--shadow-pop)]"
    >
      {!ev ? (
        <div data-testid="chat.evidence-hover.loading" className="mn-skel h-3.5 w-3/4" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-[11.5px]">
            <span className={`rounded-chip px-1.5 py-[1px] font-medium ${TONE_CLASS[chipTone(ev.source_type)]}`}>
              {label}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-ink-2">{ev.title}</span>
            <span className="flex-none text-muted">{longPosition(ev)}</span>
          </div>
          <p className="mt-2 line-clamp-4 text-[12.5px] leading-[1.65] text-ink-2">{ev.quote}</p>
        </>
      )}
    </div>
  );
}
