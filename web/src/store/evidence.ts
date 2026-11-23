// 规格：docs/ux/state.md「useEvidence」。
import { create } from 'zustand';
import type { Evidence, ID } from '../api/types';
import { useChat } from './chat';
import { useLayout, type Tab, type TabKind } from './layout';

export interface HoverInfo {
  eid: ID;
  rect: { x: number; y: number; width: number; height: number };
}

export interface SelectOptions {
  /** （F4 追加）证据本体：历史消息的证据不在流式池里，由调用方从 ['evidence', eid] 取到后传入，用来打开对应预览标签 */
  evidence?: Evidence;
  /** （F4 追加）本回答的证据顺序（证据栏左右切换用）；缺省时沿用流式池顺序 */
  evidenceIds?: ID[];
  /** （F5 追加）分支面板里打开时为分支当前叶子：右栏读证据/快照时带 `leaf_id`（契约 v0.4，U44）；主线为空 */
  leafId?: ID | null;
}

export interface EvidenceState {
  /** 当前在右栏定位的证据 */
  selectedEvidenceId: ID | null;
  /** （F4 追加）当前证据是从哪条回答打开的（证据栏“被…引用”与左右切换用） */
  selectedMessageId: ID | null;
  /** 当前回答的证据 id 列表（证据栏左右切换用） */
  messageEvidence: ID[];
  /** 设置选中并调用 useLayout.openTab 打开对应预览；第三个参数为 F4 追加（可选） */
  select: (eid: ID, messageId: ID, opts?: SelectOptions) => void;
  /** （F4 追加）证据栏按回答的引用（去掉 removed、按序号）算出列表后写回 */
  setMessageEvidence: (ids: ID[]) => void;
  /** 悬停浮层 */
  hover: HoverInfo | null;
  /** （F5 追加）当前证据从分支面板打开时的分支叶子（右栏请求带 leaf_id）；主线为 null */
  selectedLeafId: ID | null;
}

/** 证据 → 右栏预览标签。material 按 locator 形状区分 pdf / pptx / code / md；ref_id 取打开预览所需的 id。 */
export function tabForEvidence(ev: Evidence): Tab {
  const loc = ev.locator as Record<string, unknown>;
  let kind: TabKind;
  let ref_id = ev.source_id;
  switch (ev.source_type) {
    case 'web':
      kind = 'web';
      ref_id = typeof loc.snapshot_id === 'string' ? loc.snapshot_id : ev.source_id;
      break;
    case 'message':
      kind = 'message';
      ref_id = typeof loc.message_id === 'string' ? loc.message_id : ev.source_id;
      break;
    case 'plugin':
      kind = 'plugin';
      break;
    default:
      if ('page' in loc) kind = 'pdf';
      else if ('slide' in loc) kind = 'pptx';
      else if (typeof loc.path === 'string' && loc.path.toLowerCase().endsWith('.md')) kind = 'md';
      else kind = 'code';
  }
  return { id: `${kind}:${ref_id}`, kind, ref_id, title: ev.title };
}

export const useEvidence = create<EvidenceState>()((set) => ({
  selectedEvidenceId: null,
  selectedMessageId: null,
  messageEvidence: [],
  select: (eid, messageId, opts) => {
    // F0：证据来自进行中/刚结束的回答（useChat.streaming）。
    // F4：历史消息的证据由调用方经 ['evidence', eid] 取到后放在 opts.evidence；列表顺序放在 opts.evidenceIds。
    const streaming = useChat.getState().streaming;
    const pool = streaming && streaming.message_id === messageId ? streaming.evidence : [];
    const ev = pool.find((x) => x.id === eid) ?? opts?.evidence;
    const ids = opts?.evidenceIds ?? (pool.length ? pool.map((x) => x.id) : [eid]);
    set({
      selectedEvidenceId: eid,
      selectedMessageId: messageId,
      messageEvidence: ids,
      selectedLeafId: opts?.leafId ?? null,
    });
    if (ev) useLayout.getState().openTab(tabForEvidence(ev));
  },
  setMessageEvidence: (ids) =>
    set((s) =>
      s.messageEvidence.length === ids.length && s.messageEvidence.every((x, i) => x === ids[i])
        ? {}
        : { messageEvidence: ids },
    ),
  hover: null,
  selectedLeafId: null,
}));
