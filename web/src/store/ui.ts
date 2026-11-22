// 规格：docs/ux/state.md「useUI」。state.md 只列了字段，没有列 action（PROGRESS 未决 U13），这里只放字段。
import { create } from 'zustand';
import type { ID } from '../api/types';

export type ModalKind = 'card-intro' | 'new-project' | 'install' | 'settings';
export interface ModalState {
  kind: ModalKind;
  props?: Record<string, unknown>;
}

/** 字段取自规格 1-外壳-全局提示：`{kind, text, action?}`，kind ∈ info | success | error */
export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  text: string;
  action?: { label: string; onClick: () => void };
}

export type PopoverKind = 'plugins' | 'slash' | 'mention' | 'scope';

export interface TextSelection {
  message_id: ID;
  start: number;
  end: number;
  quote: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface UIState {
  modal: ModalState | null;
  toasts: Toast[];
  popover: PopoverKind | null;
  selection: TextSelection | null;
}

export const useUI = create<UIState>()(() => ({
  modal: null,
  toasts: [],
  popover: null,
  selection: null,
}));
