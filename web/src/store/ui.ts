// 规格：docs/ux/state.md「useUI」。
import { create } from 'zustand';
import type { ID } from '../api/types';

export type ModalKind = 'card-intro' | 'new-project' | 'install' | 'settings';
export interface ModalState {
  kind: ModalKind;
  props?: Record<string, unknown>;
}

/** `Toast = {id, kind, text, action?: {label, onClick}}`（state.md） */
export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  text: string;
  action?: { label: string; onClick: () => void };
}
export type ToastInput = Omit<Toast, 'id'>;

export type PopoverKind = 'plugins' | 'slash' | 'mention' | 'scope';

export interface TextSelection {
  message_id: ID;
  /** 与分支锚点同坐标：左闭右开、按码点 */
  start: number;
  end: number;
  quote: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface UIState {
  modal: ModalState | null;
  /** 同一时间只有一个弹窗，再次打开会替换 */
  openModal: (kind: ModalKind, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  toasts: Toast[];
  /** 追加一条提示，返回生成的 id；自动消失时长由 1-外壳-全局提示 规定 */
  pushToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
  popover: PopoverKind | null;
  selection: TextSelection | null;
}

let toastSeq = 0;

export const useUI = create<UIState>()((set) => ({
  modal: null,
  openModal: (kind, props) => set({ modal: props === undefined ? { kind } : { kind, props } }),
  closeModal: () => set({ modal: null }),
  toasts: [],
  pushToast: (toast) => {
    toastSeq += 1;
    const id = `toast_${toastSeq}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  popover: null,
  selection: null,
}));
