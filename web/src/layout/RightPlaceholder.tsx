// 右栏占位（F4 实现 1-外壳-右栏 与标签条）。这里只放收起按钮与已打开标签的标题，方便验证外壳行为。
import { useLayout } from '../store/layout';
import CollapseButton from './CollapseButton';

export default function RightPlaceholder() {
  const tabs = useLayout((s) => s.rightTabs);
  const active = useLayout((s) => s.activeTab);
  return (
    <aside
      data-testid="right.placeholder"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-surface"
    >
      <div className="flex h-11 flex-none items-center gap-1 border-b border-line px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {tabs.map((t) => (
            <span
              key={t.id}
              data-testid={`right.placeholder-tab:${t.id}`}
              data-active={t.id === active || undefined}
              className={`max-w-[190px] truncate rounded-btn px-2.5 py-1 text-[12.5px] ${
                t.id === active ? 'text-ink ring-1 ring-line' : 'text-muted'
              }`}
            >
              {t.title}
            </span>
          ))}
        </div>
        <CollapseButton index={3} />
      </div>
      <div className="flex flex-1 items-center justify-center text-[12.5px] text-faint">右栏占位：F4 实现</div>
    </aside>
  );
}
