// 规格：1-外壳-全局快捷键（shell.shortcuts）
// Alt(Option)+1 项目栏、Alt+2 文件栏、⌘/Ctrl+. 右栏、⌘/Ctrl+K 新建对话；Esc 依次关闭 弹层 → 弹窗 → 划词工具条。
// Alt+1/2 只看 event.code（Digit1/Digit2）：Mac 的 Option+1 会产生“¡”等字符，e.key 不可靠；
// ⌘/Ctrl+1/2 在浏览器里是切换标签页、页面拦不到，故不再使用（编排决定 U20）。
// Windows 的 AltGr（= Ctrl+Alt）不拦截。在 input/textarea 里只响应这些组合键，不拦截普通字符键。
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
      if (e.altKey && !mod && !e.shiftKey) {
        const byCode: Record<string, PanelIndex> = { Digit1: 0, Digit2: 1 };
        const idx = byCode[e.code];
        if (idx !== undefined) {
          e.preventDefault(); // 同时阻止 Mac Option 组合往输入框里插字符
          toggle(idx);
        }
        return;
      }
      if (mod && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        // e.code 兜底：部分键盘布局下 e.key 不是 .
        if (k === '.' || e.code === 'Period') {
          e.preventDefault();
          toggle(3);
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
