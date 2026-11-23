// 规格：1-对话栏-分支概览标签（chat.branch-chip）
// 对话栏标题右侧“⑂ 主线 · 2 个分支”。点击弹出本对话分支列表（标题、锚点原句前 20 字、状态）；点某个分支 → 右栏打开该分支
// 并把主线滚到锚点。0 个分支只显示“主线”、不可点；merged/archived 在列表里灰色，标“已合并”/“已归档”。
// 计数不含 archived（与 ConversationSummary.branch_count 一致，U47）。
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Branch, ConversationTree } from '../api/types';
import { goToAnchor, openBranchTab } from '../branch/actions';
import { countedBranches, STATUS_TEXT } from '../branch/model';
import { BranchIcon } from '../icons/Icons';

const head20 = (s: string) => {
  const cs = Array.from(s);
  return cs.length > 20 ? `${cs.slice(0, 20).join('')}…` : s;
};

export default function BranchOverview({ tree }: { tree: ConversationTree }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const n = countedBranches(tree.branches).length;
  const list = [...tree.branches].sort((a, b) => a.created_at.localeCompare(b.created_at));

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (b: Branch) => {
    setOpen(false);
    openBranchTab(b);
    void goToAnchor(qc, b);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  };

  const chipClass =
    'inline-flex h-[24px] flex-none items-center gap-1.5 rounded-btn border border-line bg-surface px-2 text-[12px] text-muted';

  if (tree.branches.length === 0) {
    return (
      <span data-testid="chat.branch-chip" data-count={0} aria-disabled="true" className={chipClass}>
        <BranchIcon size={13} />
        主线
      </span>
    );
  }

  return (
    <div className="relative flex-none">
      <button
        ref={btn}
        type="button"
        data-testid="chat.branch-chip"
        data-count={n}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`mn-focus ${chipClass} hover:text-ink`}
      >
        <BranchIcon size={13} />
        主线 · {n} 个分支
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="本对话的分支"
          data-testid="chat.branch-chip.menu"
          onKeyDown={onKey}
          className="absolute left-0 top-[30px] z-30 w-[300px] rounded-card-sm border border-line bg-surface py-1 shadow-[var(--shadow-pop)]"
        >
          {list.map((b) => {
            const live = b.status === 'open';
            return (
              <button
                key={b.id}
                type="button"
                role="menuitem"
                data-testid={`chat.branch-chip.item:${b.id}`}
                data-status={b.status}
                onClick={() => pick(b)}
                className={`mn-focus flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-panel ${
                  live ? 'text-ink-2' : 'text-faint'
                }`}
              >
                <span className="flex w-full items-center gap-2 text-[12.8px]">
                  <BranchIcon size={12} />
                  <span className={`min-w-0 flex-1 truncate ${live ? 'font-medium text-ink' : ''}`}>{b.title}</span>
                  {!live && <span className="flex-none text-[11px]">{STATUS_TEXT[b.status]}</span>}
                </span>
                <span className="truncate pl-5 text-[11.5px] text-muted">“{head20(b.anchor_quote)}”</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
