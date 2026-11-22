// 规格：docs/ux/state.md「useEvidence」。
import { create } from 'zustand';
import type { Evidence, ID } from '../api/types';
import { useChat } from './chat';
import { useLayout, type Tab, type TabKind } from './layout';

export interface HoverInfo {
  eid: ID;
  rect: { x: number; y: number; width: number; height: number };
}

export interface EvidenceState {
  /** 当前在右栏定位的证据 */
  selectedEvidenceId: ID | null;
  /** 当前回答的证据 id 列表（证据栏左右切换用） */
  messageEvidence: ID[];
  /** 设置选中并调用 useLayout.openTab 打开对应预览 */
  select: (eid: ID, messageId: ID) => void;
  /** 悬停浮层 */
  hover: HoverInfo | null;
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
  messageEvidence: [],
  select: (eid, messageId) => {
    // F0：证据来自进行中/刚结束的回答（useChat.streaming）。历史消息的证据由 F4 经 ['evidence', eid] 查询补上。
    const streaming = useChat.getState().streaming;
    const pool = streaming && streaming.message_id === messageId ? streaming.evidence : [];
    const ev = pool.find((x) => x.id === eid);
    set({ selectedEvidenceId: eid, messageEvidence: pool.map((x) => x.id) });
    if (ev) useLayout.getState().openTab(tabForEvidence(ev));
  },
  hover: null,
}));
