// 规格：2-插件与Skill-市场页（market.page）
// 占据中间区与右栏位置的市场页（文件栏、右栏在市场页隐藏，项目栏保留）：标题、标签切换、搜索、类别筛选、排序、卡片网格。
// 数据：插件/Skill 标签读 ['market', 'plugins'|'skills']；“已安装”标签读 ['plugins']、['skills']，再与市场条目对上。
import { useMemo } from 'react';
import { useMarket, usePlugins, useSkills } from '../api/queries';
import type { MarketItem, Skill } from '../api/types';
import { useViewportWidth } from '../lib/useViewportWidth';
import { useLayout, type MarketRoute } from '../store/layout';
import CategoryChips from './CategoryChips';
import { categoriesOf, displayRepo, filterItems } from './format';
import ImportSkillButton from './ImportSkillDialog';
import MarketCard, { MarketCardSkeleton } from './MarketCard';
import MarketTabs from './MarketTabs';
import { SearchBox } from './MarketToolbar';
import { goMarketTab, useMarketParams } from './marketNav';
import PluginDetail from './PluginDetail';
import SkillDetail from './SkillDetail';
import SortMenu from './SortMenu';

/** 网格：宽 ≥ 1280 三列，否则两列（规格「交互细则」，按窗口宽度） */
export const THREE_COLUMNS_MIN = 1280;
const SKELETONS = 6;

/** 不在 registry 里的自定义 Skill（本机或其他仓库导入）：只用 Skill 自身字段拼一张卡，不显示星数 */
function customSkillItem(s: Skill): MarketItem {
  return {
    id: s.id,
    type: 'skill',
    name: s.name,
    owner: s.source_url ? displayRepo(s.source_url) : s.dir_path,
    official: false,
    stars: 0,
    stars_date: '',
    license: s.license ?? '',
    category: '自行导入',
    desc_zh: s.description,
    repo_url: s.source_url ?? '',
    installed: true,
  };
}

export default function MarketPage() {
  const route = useLayout((s) => s.marketRoute);
  return (
    <section
      data-testid="market.page"
      aria-label="插件与 Skill"
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-line bg-surface"
    >
      {route.detail?.type === 'plugin' ? (
        <PluginDetail id={route.detail.id} tab={route.tab} />
      ) : route.detail?.type === 'skill' ? (
        <SkillDetail id={route.detail.id} tab={route.tab} />
      ) : (
        <MarketList tab={route.tab} />
      )}
    </section>
  );
}

function MarketList({ tab }: { tab: MarketRoute['tab'] }) {
  const vw = useViewportWidth();
  const [params, setParams] = useMarketParams();
  const marketPlugins = useMarket('plugins');
  const marketSkills = useMarket('skills');
  const plugins = usePlugins();
  const skills = useSkills();

  const installedItems = useMemo<MarketItem[] | undefined>(() => {
    if (!plugins.data || !skills.data || !marketPlugins.data || !marketSkills.data) return undefined;
    const pi = plugins.data.plugins
      .map((p) => marketPlugins.data.items.find((m) => m.id === p.id))
      .filter((m): m is MarketItem => !!m)
      .map((m) => ({ ...m, installed: true }));
    const si = skills.data.skills.map((s) => {
      const m = marketSkills.data.items.find((x) => x.id === s.id);
      return m ? { ...m, installed: true } : customSkillItem(s);
    });
    return [...pi, ...si];
  }, [plugins.data, skills.data, marketPlugins.data, marketSkills.data]);

  const source = tab === 'plugins' ? marketPlugins : tab === 'skills' ? marketSkills : null;
  const all: MarketItem[] | undefined = source ? source.data?.items : installedItems;
  const isPending = source
    ? source.isPending
    : plugins.isPending || skills.isPending || marketPlugins.isPending || marketSkills.isPending;
  const failed = source
    ? source.isError
    : plugins.isError || skills.isError || marketPlugins.isError || marketSkills.isError;
  const retry = () => {
    if (source) void source.refetch();
    else for (const q of [plugins, skills, marketPlugins, marketSkills]) if (q.isError) void q.refetch();
  };

  const categories = useMemo(() => categoriesOf(all ?? []), [all]);
  const category = params.cat && categories.includes(params.cat) ? params.cat : null;
  const shown = useMemo(
    () => filterItems(all ?? [], params.q, category, params.sort),
    [all, params.q, category, params.sort],
  );

  /** 色块颜色按条目在本类 registry 中的序号 */
  const colorIndex = (it: MarketItem) => {
    const list = it.type === 'plugin' ? marketPlugins.data?.items : marketSkills.data?.items;
    return list?.findIndex((m) => m.id === it.id) ?? -1;
  };

  const counts = {
    plugins: marketPlugins.data?.items.length,
    skills: marketSkills.data?.items.length,
    installed: plugins.data && skills.data ? plugins.data.plugins.length + skills.data.skills.length : undefined,
  };
  const starsDate = marketPlugins.data?.items[0]?.stars_date ?? marketSkills.data?.items[0]?.stars_date;
  const cols = vw >= THREE_COLUMNS_MIN ? 3 : 2;
  const hasFilter = !!params.q || !!category;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="px-9 pt-[26px]">
        <h1 className="font-serif text-[26px] font-semibold tracking-[0.5px] text-ink">插件与 Skill</h1>
        <p className="mt-1 text-[13px] text-muted">
          插件给助手增加可调用的工具（MCP Server），Skill 教助手一套做事方法（SKILL.md）。条目来自 GitHub
          {starsDate ? `，星数取于 ${starsDate}` : ''}。
        </p>
        <MarketTabs
          active={tab}
          counts={counts}
          onSelect={(t) => {
            goMarketTab(t);
            setParams({ cat: null }); // 保留搜索词、清空类别（包括本地 state，避免迟到的搜索防抖把旧类别写回地址栏）
          }}
        />
      </header>

      <div className="flex items-center gap-2.5 px-9 pb-1.5 pt-4">
        <SearchBox
          value={params.q}
          onChange={(q) => setParams({ q })}
          placeholder={
            tab === 'plugins'
              ? '搜索插件：名称、作者、用途或类别'
              : tab === 'skills'
                ? '搜索 Skill：名称、作者、用途或类别'
                : '搜索已安装的插件与 Skill'
          }
        />
        <CategoryChips categories={categories} value={category} onChange={(cat) => setParams({ cat })} />
        <SortMenu value={params.sort} onChange={(sort) => setParams({ sort })} />
        {tab === 'skills' && <ImportSkillButton />}
      </div>

      {failed && !all ? (
        <div
          data-testid="market.page.error"
          role="alert"
          className="mx-9 mt-6 flex items-center gap-1.5 text-[13px] text-ink-2"
        >
          市场数据加载失败 ·
          <button
            type="button"
            data-testid="market.page.retry"
            onClick={retry}
            className="mn-focus rounded-btn-sm text-ink underline underline-offset-2"
          >
            重试
          </button>
        </div>
      ) : isPending && !all ? (
        <div
          data-testid="market.page.loading"
          aria-busy="true"
          className="grid gap-3.5 px-9 pb-6 pt-3"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: SKELETONS }, (_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div
          data-testid="market.page.empty"
          className="mx-9 mt-8 flex flex-col items-start gap-2 text-[13px] text-muted"
        >
          {hasFilter ? (
            <>
              <span>没有匹配的条目</span>
              <button
                type="button"
                data-testid="market.page.clear-filters"
                onClick={() => setParams({ q: '', cat: null })}
                className="mn-focus rounded-btn border border-line px-3 py-1 text-[12.5px] text-ink-2 hover:bg-sel"
              >
                清空筛选
              </button>
            </>
          ) : (
            <span>还没有安装任何插件或 Skill。</span>
          )}
        </div>
      ) : (
        <>
          <ul
            data-testid="market.grid"
            data-cols={cols}
            className="grid gap-3.5 px-9 pb-6 pt-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {shown.map((it) => (
              <li key={`${it.type}:${it.id}`} className="min-w-0">
                <MarketCard item={it} index={colorIndex(it)} />
              </li>
            ))}
          </ul>
          <p data-testid="market.page.footer" className="px-9 pb-4 text-[11.5px] text-faint">
            {tab === 'plugins' && `共 ${shown.length} 个插件 · 安装前会列出它需要的权限与 API Key`}
            {tab === 'skills' && `共 ${shown.length} 个 Skill · 也可以导入本地含 SKILL.md 的文件夹`}
            {tab === 'installed' && `共 ${shown.length} 项 · 插件在对话里可以按会话开关`}
          </p>
        </>
      )}
    </div>
  );
}
