// 规格：1-右栏-标签条（right.tabs）
// 分支标签带分支图标，文件标签带类型色块；悬停（或聚焦、激活）显示 ×，中键关闭。右端是“更多”（列出全部标签）和收起按钮。
// 超出宽度时横向滚动，激活标签自动滚入视野；最多 8 个标签（超出时关闭最早未激活的非分支标签，见 store/layout.ts openTab）。
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BubbleIcon } from '../icons/ChatIcons';
import { BranchIcon, CloseIcon, GlobeIcon, PuzzleIcon } from '../icons/Icons';
import { MoreIcon } from '../icons/PreviewIcons';
import CollapseButton from '../layout/CollapseButton';
import { badgeOf } from '../lib/documents';
import { useLayout, type Tab } from '../store/layout';

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 flex-none items-center justify-center rounded-[3px] text-[7.5px] font-bold tracking-[-0.2px] text-surface ${cls}`}
    >
      {label}
    </span>
  );
}

export function TabIcon({ tab }: { tab: Tab }): ReactNode {
  switch (tab.kind) {
    case 'branch':
      return <BranchIcon size={14} className="text-muted" />;
    case 'web':
      return <GlobeIcon size={14} className="text-evi-web-ink" />;
    case 'message':
      return <BubbleIcon size={14} className="text-evi-msg-ink" />;
    case 'plugin':
      return <PuzzleIcon size={14} className="text-evi-web-ink" />;
    case 'pdf':
      return <Badge {...badgeOf({ kind: 'pdf', title: tab.title })} />;
    case 'pptx':
      return <Badge {...badgeOf({ kind: 'pptx', title: tab.title })} />;
    case 'md':
      return <Badge {...badgeOf({ kind: 'md', title: tab.title })} />;
    case 'code':
      return <Badge {...badgeOf({ kind: /\.ipynb$/i.test(tab.title) ? 'ipynb' : 'code', title: tab.title })} />;
  }
}

export default function PreviewTabs() {
  const tabs = useLayout((s) => s.rightTabs);
  const active = useLayout((s) => s.activeTab);
  const activateTab = useLayout((s) => s.activateTab);
  const closeTab = useLayout((s) => s.closeTab);
  const stripRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 激活标签自动滚入视野
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(active ?? '')}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  // “更多”菜单：点外面或 Esc 关闭，关闭后焦点回到按钮
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !moreRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
      moreRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className="relative flex h-11 flex-none items-center gap-1 border-b border-line pl-2 pr-1.5">
      <div
        ref={stripRef}
        data-testid="right.tabs"
        role="tablist"
        aria-label="右栏标签"
        className="mn-tabstrip flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <div
              key={t.id}
              data-tab-id={t.id}
              data-testid={`right.tabs.tab:${t.id}`}
              data-active={on || undefined}
              className={`group relative flex max-w-[200px] flex-none items-center rounded-btn text-[12.5px] ${
                on ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-muted hover:bg-panel hover:text-ink-2'
              }`}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(t.id);
                }
              }}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            >
              <button
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`right.tabs.activate:${t.id}`}
                title={t.title}
                onClick={() => activateTab(t.id)}
                className="mn-focus flex min-w-0 items-center gap-1.5 rounded-btn py-1 pl-2 pr-6"
              >
                <TabIcon tab={t} />
                <span className="min-w-0 truncate">{t.title}</span>
              </button>
              <button
                type="button"
                data-testid={`right.tabs.close:${t.id}`}
                aria-label={`关闭 ${t.title}`}
                title="关闭"
                onClick={() => closeTab(t.id)}
                className={`mn-focus absolute right-1 flex h-4 w-4 items-center justify-center rounded-[4px] text-muted hover:bg-sel hover:text-ink focus-visible:opacity-100 ${
                  on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <CloseIcon size={11} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        ref={moreRef}
        type="button"
        data-testid="right.tabs.more"
        aria-label="全部标签"
        title="全部标签"
        aria-haspopup="menu"
        aria-expanded={menu}
        disabled={tabs.length === 0}
        onClick={() => setMenu((x) => !x)}
        className="mn-iconbtn disabled:opacity-40"
      >
        <MoreIcon />
      </button>
      <CollapseButton index={3} />
      {menu && (
        <div
          ref={menuRef}
          data-testid="right.tabs.menu"
          role="menu"
          aria-label="全部标签"
          onKeyDown={onMenuKey}
          className="absolute right-10 top-10 z-20 w-[240px] rounded-card-sm border border-line bg-surface py-1 shadow-[var(--shadow-pop)]"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              data-testid={`right.tabs.menu-item:${t.id}`}
              onClick={() => {
                activateTab(t.id);
                setMenu(false);
                moreRef.current?.focus();
              }}
              className={`mn-focus flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-panel ${
                t.id === active ? 'text-ink' : 'text-ink-2'
              }`}
            >
              <TabIcon tab={t} />
              <span className="min-w-0 truncate">{t.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
