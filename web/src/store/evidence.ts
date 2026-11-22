// 规格：docs/ux/state.md「useEvidence」。
import { create } from 'zustand';
import type { ID } from '../api/types';

export interface HoverInfo {
  eid: ID;
  rect: { x: number; y: number; width: number; height: number };
}

export interface EvidenceState {
  /** 当前在右栏定位的证据 */
  selectedEvidenceId: ID | null;
  /** 当前回答的证据 id 列表（证据栏左右切换用） */
  messageEvidence: ID[];
  /** 设置选中并打开对应预览 */
  select: (eid: ID, messageId: ID) => void;
  /** 悬停浮层 */
  hover: HoverInfo | null;
}

export const useEvidence = create<EvidenceState>()((set) => ({
  selectedEvidenceId: null,
  messageEvidence: [],
  select: (eid, _messageId) => {
    set({ selectedEvidenceId: eid });
    // TODO(F4)：按证据来源调用 useLayout.openTab({kind, ref_id, ...})。
    // ref_id 需要证据的 source_id，而 SSE evidence 事件不带它（PROGRESS 未决 U12），F4 开工前先定。
  },
  hover: null,
}));
