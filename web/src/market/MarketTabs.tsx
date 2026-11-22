// 规格：2-市场页-标签切换（market.tabs）
// “插件市场 / Skill 市场 / 已安装”三个标签；点击改路由 `/market/:tab`，保留搜索词、清空类别。
import { useRef, type KeyboardEvent } from 'react';
import { PuzzleIcon } from '../icons/Icons';
import type { MarketRoute } from '../store/layout';
import { BookIcon, CheckIcon } from './icons';

type TabKey = MarketRoute['tab'];
const TABS: { key: TabKey; label: string; icon: JSX.Element }[] = [
  { key: 'plugins', label: '插件市场', icon: <PuzzleIcon size={14} /> },
  { key: 'skills', label: 'Skill 市场', icon: <BookIcon size={14} /> },
  { key: 'installed', label: '已安装', icon: <CheckIcon size={13} /> },
];

export interface MarketTabsProps {
  active: TabKey;
  counts: Partial<Record<TabKey, number>>;
  onSelect: (tab: TabKey) => void;
}

export default function MarketTabs({ active, counts, onSelect }: MarketTabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // 左右方向键在标签间移动（WAI-ARIA tabs）
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    refs.current[next]?.focus();
    onSelect(TABS[next].key);
  };
  return (
    <div
      data-testid="market.tabs"
      role="tablist"
      aria-label="市场分类"
      className="mt-[18px] flex gap-[26px] border-b border-line"
    >
      {TABS.map((t, i) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-testid={`market.tabs:${t.key}`}
            onClick={() => onSelect(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`mn-focus flex items-center gap-1.5 px-0.5 pb-[11px] text-[14px] ${
              on ? 'font-semibold text-ink shadow-[inset_0_-2px_0_var(--ink)]' : 'text-muted hover:text-ink-2'
            }`}
          >
            {t.icon}
            {t.label}
            {counts[t.key] !== undefined && (
              <span className="text-[11.5px] font-normal text-faint">{counts[t.key]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
