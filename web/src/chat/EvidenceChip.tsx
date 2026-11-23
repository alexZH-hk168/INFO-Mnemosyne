// 规格：1-助手回答-证据胶囊（chat.evidence-chip）
// 句末小胶囊“1 · p.4”。琥珀＝材料、蓝＝网页/插件、灰＝历史对话（配色见 evidence-locator.md）。
// 状态：待确认（只收到 delta 未收到 citation）同色 1px 虚线、60% 不透明；supported 实心；partial 实心（句末“推断”由 InferenceMark 画）；
// removed 不渲染；选中外圈 0 0 0 2px #e2c47a（--evi-ring）。
// 悬停 300 ms 出原句浮层（EvidenceHover）；点击 = useEvidence.select(eid, message_id) 并打开右栏预览标签（预览内容由 F4 实现）。
import { memo, useRef } from 'react';
import { useEvidence as useEvidenceQuery } from '../api/queries';
import { useLeafId } from '../branch/leafContext';
import type { Evidence, ID, Verdict } from '../api/types';
import { labelNumber } from '../lib/citations';
import { chipText, chipTone, TONE_CLASS } from '../lib/evidenceDisplay';
import { useChat } from '../store/chat';
import { tabForEvidence, useEvidence } from '../store/evidence';
import { useLayout } from '../store/layout';

export const HOVER_OPEN_MS = 300;
export const HOVER_CLOSE_MS = 150;

// ---------------------------------------------------------------- 悬停控制（所有胶囊共用，避免在胶囊之间移动时闪烁）
let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
/** 当前浮层对应的回答（点击浮层 = 点击胶囊，需要 message_id） */
let hoverMessageId: ID | null = null;
export const getHoverMessageId = () => hoverMessageId;
/** F5 追加：浮层对应的胶囊在分支面板里时为分支叶子（读证据带 leaf_id） */
let hoverLeafId: ID | null = null;
export const getHoverLeafId = () => hoverLeafId;

export function hoverEnter(eid: ID, messageId: ID, el: HTMLElement, leafId: ID | null = null) {
  clearTimeout(closeTimer);
  clearTimeout(openTimer);
  const show = () => {
    const r = el.getBoundingClientRect();
    hoverMessageId = messageId;
    hoverLeafId = leafId;
    useEvidence.setState({ hover: { eid, rect: { x: r.x, y: r.y, width: r.width, height: r.height } } });
  };
  // 浮层已开着（从一个胶囊移到另一个）：直接切换，不再等 300 ms
  if (useEvidence.getState().hover) show();
  else openTimer = setTimeout(show, HOVER_OPEN_MS);
}

export function hoverLeave() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => useEvidence.setState({ hover: null }), HOVER_CLOSE_MS);
}

/** 浮层自身被鼠标进入时保持打开 */
export function hoverKeep() {
  clearTimeout(closeTimer);
}

export function hoverCloseNow() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  useEvidence.setState({ hover: null });
}

/** 本回答的本地证据（流式中/刚结束的那条），没有时为 undefined */
export function useLocalEvidence(messageId: ID, eid: ID | undefined, label: string): Evidence | undefined {
  return useChat((s) => {
    const st = s.streaming;
    if (!st || st.message_id !== messageId) return undefined;
    return st.evidence.find((e) => (eid ? e.id === eid : e.label === label));
  });
}

/** 打开证据：select + 右栏标签（历史消息的证据从 ['evidence', eid] 取，F0 的 select 只认流式证据池）。
 *  第四个参数 F5 追加：分支面板里打开时传分支叶子，右栏读证据带 leaf_id */
export function openEvidence(eid: ID, messageId: ID, ev: Evidence | undefined, leafId: ID | null = null) {
  hoverCloseNow();
  useEvidence.getState().select(eid, messageId, leafId ? { leafId } : undefined);
  if (ev) useLayout.getState().openTab(tabForEvidence(ev));
}

interface Props {
  messageId: ID;
  label: string;
  /** 来自 citation；待确认时由本地证据池按 label 找 */
  eid?: ID;
  verdict?: Verdict;
}

function EvidenceChip({ messageId, label, eid, verdict }: Props) {
  const local = useLocalEvidence(messageId, eid, label);
  const leafId = useLeafId();
  const id = eid ?? local?.id;
  const remote = useEvidenceQuery(local ? null : id, leafId);
  const ev = local ?? remote.data;
  const selected = useEvidence((s) => !!id && s.selectedEvidenceId === id);
  const ref = useRef<HTMLButtonElement>(null);

  if (verdict === 'removed') return null;
  const pending = !verdict;
  const tone = chipTone(ev?.source_type ?? 'material');
  const num = labelNumber(label);
  const text = chipText(num, ev);

  return (
    <button
      ref={ref}
      type="button"
      data-testid={`chat.evidence-chip:${messageId}:${label}`}
      data-state={pending ? 'pending' : verdict}
      data-eid={id}
      aria-label={`证据 ${num}${ev ? `：${ev.title}` : ''}${pending ? '（待确认）' : ''}`}
      aria-pressed={selected}
      disabled={!id}
      onClick={() => id && openEvidence(id, messageId, ev, leafId)}
      onMouseEnter={() => id && ref.current && hoverEnter(id, messageId, ref.current, leafId)}
      onMouseLeave={hoverLeave}
      onFocus={() => id && ref.current && hoverEnter(id, messageId, ref.current, leafId)}
      onBlur={hoverLeave}
      className={`mn-focus relative top-[-1px] mx-[3px] inline-flex h-[18px] items-center whitespace-nowrap rounded-chip px-[5px] align-middle text-[11px] font-medium leading-none transition-opacity ${
        TONE_CLASS[tone]
      } ${pending ? 'border border-dashed border-current opacity-60' : 'border border-transparent'} ${
        selected ? 'shadow-[0_0_0_2px_var(--evi-ring)]' : ''
      }`}
    >
      {text}
    </button>
  );
}

export default memo(EvidenceChip);
