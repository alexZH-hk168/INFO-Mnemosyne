// 规格：1-输入框-引用范围（composer.scope）
// 托条上的“引用范围”胶囊：全部材料 / 已选 N 个文件 / 不用材料；点击弹出三选一菜单。项目没有材料时置灰、固定“不用材料”。
// 概念图缺口：UI-01 只画了“引用范围：当前项目”文字，位置放在联网检索右侧（规格「待确认」）。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Scope } from '../api/types';
import { LayersIcon } from '../icons/ChatIcons';
import { useUI } from '../store/ui';

export function scopeLabel(scope: Scope, disabled: boolean): string {
  if (disabled || scope.mode === 'none') return '不用材料';
  if (scope.mode === 'selected') return `已选 ${scope.document_ids?.length ?? 0} 个文件`;
  return '全部材料';
}

type Choice = 'all' | 'selected' | 'none';
const CHOICES: { mode: Choice; label: string }[] = [
  { mode: 'all', label: '全部材料' },
  { mode: 'selected', label: '只用已选文件' },
  { mode: 'none', label: '不用材料' },
];

interface Props {
  scope: Scope;
  /** 项目里没有已解析的材料 */
  disabled: boolean;
  /** 已选文件名（悬停列出） */
  selectedTitles: string[];
  /** 主页托条显示“引用范围：…” */
  withPrefix?: boolean;
  onChange: (scope: Scope) => void;
  /** 选“只用已选文件”后打开 @ 引用列表 */
  onPickFiles: () => void;
}

export default function ScopePicker({ scope, disabled, selectedTitles, withPrefix, onChange, onPickFiles }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const label = scopeLabel(scope, disabled);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (useUI.getState().popover === 'scope') useUI.setState({ popover: null });
    if (refocus) btn.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (mode: Choice) => {
    close(mode !== 'selected');
    if (mode === 'all') onChange({ mode: 'all' });
    else if (mode === 'none') onChange({ mode: 'none' });
    else {
      onChange({ mode: 'selected', document_ids: scope.mode === 'selected' ? (scope.document_ids ?? []) : [] });
      onPickFiles();
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const current: Choice = disabled ? 'none' : scope.mode;
  return (
    <div className="relative flex-none">
      <button
        ref={btn}
        type="button"
        data-testid="composer.scope"
        data-mode={current}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={scope.mode === 'selected' && selectedTitles.length > 0 ? selectedTitles.join('\n') : undefined}
        onClick={() => {
          if (open) return close(false);
          setOpen(true);
          useUI.setState({ popover: 'scope' });
        }}
        className={`mn-focus inline-flex h-7 flex-none items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-[12.5px] ${
          disabled ? 'cursor-default text-faint' : open ? 'bg-surface text-ink' : 'text-muted hover:text-ink-2'
        }`}
      >
        <LayersIcon size={14} />
        {withPrefix ? `引用范围：${label}` : label}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="引用范围"
          data-testid="composer.scope.menu"
          onKeyDown={onMenuKey}
          className="absolute bottom-full left-0 z-30 mb-2 w-[176px] rounded-card border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          {CHOICES.map((c) => (
            <button
              key={c.mode}
              type="button"
              role="menuitemradio"
              aria-checked={current === c.mode}
              data-testid={`composer.scope.option:${c.mode}`}
              onClick={() => pick(c.mode)}
              className="mn-focus flex w-full items-center justify-between rounded-btn px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-sel focus-visible:bg-sel"
            >
              {c.label}
              {current === c.mode && <span className="text-[11px] text-muted">当前</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
