// 栏的“有效收起状态”与切换函数，由 FourPane 提供给收起按钮、竖条和快捷键。
// 有效收起 = 用户收起（useLayout.collapsed，持久化）或 运行时自动收起（窄窗口 / 新对话且无材料，不写 localStorage）。
import { createContext, useContext } from 'react';
import type { PanelIndex } from '../store/layout';

export interface PanelControl {
  /** 四栏当前是否显示为竖条 */
  effective: [boolean, boolean, boolean, boolean];
  /** 收起 / 展开第 i 栏（对话栏 i=2 不可收起） */
  toggle: (i: PanelIndex) => void;
}

export const PanelControlContext = createContext<PanelControl | null>(null);

export function usePanelControl(): PanelControl {
  const ctx = useContext(PanelControlContext);
  if (!ctx) throw new Error('usePanelControl 必须在 FourPane 内使用');
  return ctx;
}
