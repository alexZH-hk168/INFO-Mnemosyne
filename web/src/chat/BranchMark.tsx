// 规格：1-助手回答-分支标记（chat.branch-mark）
// 已开过分支的原句加虚线下划线（BranchMarkText），句末小标“⑂ 分支”（BranchMarkBadge，按钮）。
// 状态：同一句有多个分支 → 小标“⑂ 2”，点击弹出选择；分支 merged → 下划线改为实线淡色。
// 点击 → 右栏打开该分支（useLayout.openTab({kind:"branch", ref_id})）。
// “回到原处”（2-分支面板-来源原句与回到原处）经 flashBranch 事件让对应原句闪烁高亮 1.2 s。
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Branch, ID } from '../api/types';
import { BranchIcon } from '../icons/Icons';
import { FLASH_EVENT, FLASH_MS, openBranchTab } from '../branch/actions';
import type { MarkGroup } from '../lib/branchMarkup';

function useFlash(group: MarkGroup): boolean {
  const [on, setOn] = useState(false);
  const ids = group.branches.map((b) => b.id).join(' ');
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onFlash = (e: Event) => {
      const bid = (e as CustomEvent<{ bid: ID }>).detail?.bid;
      if (!bid || !ids.split(' ').includes(bid)) return;
      setOn(false);
      // 下一帧再打开，连续点击也能重新闪
      requestAnimationFrame(() => setOn(true));
      clearTimeout(t);
      t = setTimeout(() => setOn(false), FLASH_MS);
    };
    window.addEventListener(FLASH_EVENT, onFlash);
    return () => {
      window.removeEventListener(FLASH_EVENT, onFlash);
      clearTimeout(t);
    };
  }, [ids]);
  return on;
}

const allMerged = (g: MarkGroup) => g.branches.every((b) => b.status === 'merged');

/** 下划线部分（可能被元素边界拆成几段，每段一个 span） */
export function BranchMarkText({ group, children }: { group: MarkGroup; children?: ReactNode }) {
  const flash = useFlash(group);
  return (
    <span
      data-mn-branch-ids={group.branches.map((b) => b.id).join(' ')}
      data-merged={allMerged(group) || undefined}
      data-flash={flash || undefined}
      className="mn-branch-text"
    >
      {children}
    </span>
  );
}

/** 句末小标 */
export function BranchMarkBadge({ group, messageId }: { group: MarkGroup; messageId: ID }) {
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLSpanElement>(null);
  const first = group.branches[0];
  const many = group.branches.length > 1;

  useEffect(() => {
    if (!menu) return;
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const pick = (b: Branch) => {
    setMenu(false);
    openBranchTab(b);
  };

  const onMenuKey = (e: KeyboardEvent<HTMLSpanElement>) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  };

  return (
    <span data-mn-skip="" className="relative">
      <button
        ref={btn}
        type="button"
        data-testid={`chat.branch-mark:${first.id}`}
        data-message-id={messageId}
        data-count={group.branches.length}
        data-merged={allMerged(group) || undefined}
        aria-haspopup={many ? 'menu' : undefined}
        aria-expanded={many ? menu : undefined}
        aria-label={many ? `${group.branches.length} 个分支` : `打开分支：${first.title}`}
        title={many ? group.branches.map((b) => b.title).join('、') : first.title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (many ? setMenu((x) => !x) : pick(first))}
        className="mn-focus relative top-[-1px] mx-[3px] inline-flex h-[17px] select-none items-center gap-[2px] whitespace-nowrap rounded-chip border border-line bg-surface px-[4px] align-middle text-[10.5px] leading-none text-muted hover:text-ink"
      >
        <BranchIcon size={10} />
        {many ? group.branches.length : '分支'}
      </button>
      {menu && (
        <span
          ref={list}
          role="menu"
          aria-label="选择分支"
          data-testid={`chat.branch-mark.menu:${first.id}`}
          onKeyDown={onMenuKey}
          className="absolute left-0 top-[22px] z-30 block w-[220px] rounded-card-sm border border-line bg-surface py-1 text-left shadow-[var(--shadow-pop)]"
        >
          {group.branches.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitem"
              data-testid={`chat.branch-mark.option:${b.id}`}
              onClick={() => pick(b)}
              className={`mn-focus flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-panel ${
                b.status === 'open' ? 'text-ink-2' : 'text-faint'
              }`}
            >
              <BranchIcon size={12} />
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
              {b.status === 'merged' && <span className="flex-none text-[11px]">已合并</span>}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
