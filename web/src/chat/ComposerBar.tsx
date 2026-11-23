// 规格：1-输入框-联网检索开关（composer.web-toggle）、1-输入框-插件区入口（composer.plugin-entry，里程碑 F6）
// 输入框外层托条：联网检索开关、引用范围（ScopePicker）、已启用插件。
// 插件区：F3 做胶囊外观与打开动作（useUI.popover="plugins"）；F6b 接上会话插件弹层（PluginPopoverSlot → plugins/PluginPopover）
// 与插件简称（short_name，缺省退回全名）。胶囊只列可用且已启用的插件；主页读已安装插件的默认启用状态（含弹层里暂存的改动）。
import type { ReactNode } from 'react';
import type { ID } from '../api/types';
import { GlobeIcon, PuzzleIcon } from '../icons/Icons';
import { useUI } from '../store/ui';
import PluginPopover, { ENTRY_ATTR } from './plugins/PluginPopover';
import { usePluginRows } from './plugins/pluginRows';

export function WebToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="composer.web-toggle"
      aria-pressed={on}
      onClick={onToggle}
      className={`mn-focus inline-flex h-7 flex-none items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-[12.5px] ${
        on ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-muted hover:text-ink-2'
      }`}
    >
      <GlobeIcon size={14} />
      联网检索
    </button>
  );
}

/** 本对话已启用（且可用）插件的简称；主页（无 cid）用已安装插件的默认启用状态（F6b：改用简称，原 U36） */
export function usePluginNames(cid: ID | null | undefined): string[] {
  const { rows } = usePluginRows(cid);
  return rows.filter((r) => r.enabled).map((r) => r.short);
}

interface PluginEntryProps {
  cid: ID | null | undefined;
  /** names：列出插件名（对话栏，UI-05）；enabled：“已启用 N 个插件”（主页托条，UI-01）；count：“插件 · N”（主页内层，UI-01） */
  format?: 'names' | 'enabled' | 'count';
  testid?: string;
  className?: string;
}

/** 插件胶囊：点击在输入框上方打开会话插件弹层（F6b）。名字用简称（“arXiv · 网页检索 · PDF 解析”），没有简称时用全名 */
export function PluginEntry({ cid, format = 'names', testid = 'composer.plugin-entry', className }: PluginEntryProps) {
  const names = usePluginNames(cid);
  const open = useUI((s) => s.popover === 'plugins');
  const n = names.length;
  const label =
    n === 0
      ? '插件'
      : format === 'enabled'
        ? `已启用 ${n} 个插件`
        : format === 'count'
          ? `插件 · ${n}`
          : names.join(' · ');
  return (
    <button
      type="button"
      data-testid={testid}
      {...{ [ENTRY_ATTR]: '' }}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={names.join(' · ') || undefined}
      onClick={() => useUI.setState({ popover: open ? null : 'plugins' })}
      className={`mn-focus inline-flex h-7 min-w-0 max-w-[340px] shrink items-center whitespace-nowrap gap-1.5 rounded-pill px-2.5 text-[12.5px] ${
        open ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-muted hover:text-ink-2'
      } ${className ?? ''}`}
    >
      <PuzzleIcon size={14} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** 会话插件弹层（2-插件区-会话插件弹层）的挂载点：useUI.popover === 'plugins' 时在输入框上方渲染（F6b） */
export function PluginPopoverSlot({ cid }: { cid: ID | null | undefined }): ReactNode {
  const open = useUI((s) => s.popover === 'plugins');
  return open ? <PluginPopover cid={cid} /> : null;
}

interface BarProps {
  webOn: boolean;
  onToggleWeb: () => void;
  scope: ReactNode;
  cid: ID | null | undefined;
  variant: 'home' | 'chat';
}

export default function ComposerBar({ webOn, onToggleWeb, scope, cid, variant }: BarProps) {
  return (
    <div data-testid="composer.bar" className="flex h-[34px] min-w-0 items-center gap-1 px-1.5">
      <WebToggle on={webOn} onToggle={onToggleWeb} />
      {scope}
      <PluginEntry cid={cid} format={variant === 'home' ? 'enabled' : 'names'} />
    </div>
  );
}
