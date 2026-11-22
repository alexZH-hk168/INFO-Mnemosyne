// 规格：2-市场页-排序（market.sort）
// “推荐排序 ▾”菜单：推荐（registry 原顺序）、按星数（降序）、按名称；本地 state 写入 URL `?sort=`。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SORT_KEYS, SORT_LABEL, type SortKey } from './format';
import { ChevronDown } from './icons';

export default function SortMenu({ value, onChange }: { value: SortKey; onChange: (s: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const choose = (s: SortKey) => {
    onChange(s);
    setOpen(false);
    btnRef.current?.focus();
  };
  const onListKey = (e: KeyboardEvent) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[n]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="relative ml-auto flex-none">
      <button
        ref={btnRef}
        type="button"
        data-testid="market.sort"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mn-focus flex items-center gap-1 whitespace-nowrap rounded-btn-sm px-1.5 py-1 text-[12.5px] text-muted hover:bg-sel hover:text-ink"
      >
        {SORT_LABEL[value]}
        <ChevronDown />
      </button>
      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label="排序方式"
          data-testid="market.sort.menu"
          onKeyDown={onListKey}
          className="absolute right-0 top-[calc(100%+4px)] z-20 w-[132px] rounded-card-sm border border-line bg-surface py-1 shadow-[var(--shadow-pop)]"
        >
          {SORT_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              aria-checked={k === value}
              data-testid={`market.sort:${k}`}
              tabIndex={-1}
              onClick={() => choose(k)}
              className={`mn-focus flex w-full items-center px-3 py-1.5 text-left text-[12.5px] hover:bg-sel ${
                k === value ? 'text-ink' : 'text-ink-2'
              }`}
            >
              {SORT_LABEL[k]}
              {k === value && <span className="ml-auto text-muted">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
