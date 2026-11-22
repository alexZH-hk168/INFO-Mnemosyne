// 规格：1-项目栏-插件与Skill入口（sidebar.market-entry，F6 规格；F1 只渲染这一行与数字）
// 数字 = 已安装插件数 + 已启用 Skill 数；为 0 不显示。点击进入市场页插件标签。
import { usePlugins, useSkills } from '../api/queries';
import { PuzzleIcon } from '../icons/Icons';
import { goMarket } from '../lib/nav';
import { useLayout } from '../store/layout';

export default function MarketEntry() {
  const plugins = usePlugins();
  const skills = useSkills();
  const active = useLayout((s) => s.view === 'market');
  const count = (plugins.data?.plugins.length ?? 0) + (skills.data?.skills.filter((s) => s.enabled).length ?? 0);
  return (
    <button
      type="button"
      data-testid="sidebar.market-entry"
      aria-current={active ? 'page' : undefined}
      onClick={() => goMarket({ tab: 'plugins' })}
      className={`mn-focus flex w-full items-center gap-2.5 rounded-btn px-2 py-1.5 text-left text-[13.5px] ${
        active ? 'bg-sel text-ink' : 'text-ink-2 hover:bg-sel'
      }`}
    >
      <PuzzleIcon />
      <span>插件与 Skill</span>
      {count > 0 && (
        <span data-testid="sidebar.market-entry.count" className="ml-auto text-[12px] text-muted">
          {count}
        </span>
      )}
    </button>
  );
}
