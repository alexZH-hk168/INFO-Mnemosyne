// 规格：1-外壳-全局快捷键（shell.shortcuts）
// ⌘/Ctrl+1 项目栏、⌘/Ctrl+2 文件栏、⌘/Ctrl+. 右栏、⌘/Ctrl+K 新建对话；Esc 依次关闭 弹层 → 弹窗 → 划词工具条。
// 在 input/textarea 里只响应带 ⌘/Ctrl 的组合键，不拦截普通字符键。
import { useEffect } from 'react';
import { goHome } from '../lib/nav';
import type { PanelIndex } from '../store/layout';
import { useUI } from '../store/ui';

export function closeTopmost(): boolean {
  const ui = useUI.getState();
  if (ui.popover) {
    useUI.setState({ popover: null });
    return true;
  }
  if (ui.modal) {
    ui.closeModal();
    return true;
  }
  if (ui.selection) {
    useUI.setState({ selection: null });
    return true;
  }
  return false;
}

export function useShortcuts(toggle: (i: PanelIndex) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        const panel: Record<string, PanelIndex> = { '1': 0, '2': 1, '.': 3 };
        // e.code 兜底：部分键盘布局下 e.key 不是 1/2/.
        const byCode: Record<string, PanelIndex> = { Digit1: 0, Digit2: 1, Period: 3 };
        const idx = panel[k] ?? byCode[e.code];
        if (idx !== undefined) {
          e.preventDefault();
          toggle(idx);
          return;
        }
        if (k === 'k') {
          e.preventDefault();
          goHome();
          return;
        }
        return;
      }
      if (e.key === 'Escape' && !mod) {
        if (closeTopmost()) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}
