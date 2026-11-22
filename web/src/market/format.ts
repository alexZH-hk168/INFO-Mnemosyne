// 市场页的纯函数：星数格式、首字母色块、筛选与排序。不含任何演示数据（R4）。
import type { InstalledPlugin, MarketItem } from '../api/types';

export type SortKey = 'recommended' | 'stars' | 'name';
export const SORT_LABEL: Record<SortKey, string> = {
  recommended: '推荐排序',
  stars: '按星数',
  name: '按名称',
};
export const SORT_KEYS: SortKey[] = ['recommended', 'stars', 'name'];
export const isSortKey = (s: string | null): s is SortKey => !!s && (SORT_KEYS as string[]).includes(s);

/** 卡片上的短格式（概念图 UI-07）：571、3.3k、92k、197k */
export function formatStarsShort(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k < 10) return `${Math.round(k * 10) / 10}k`.replace('.0k', 'k');
  return `${Math.round(k)}k`;
}

/** 千分位：3,292（详情页与悬停提示） */
export const formatStarsFull = (n: number) => n.toLocaleString('en-US');

export const starsTooltip = (item: Pick<MarketItem, 'stars' | 'stars_date'>) =>
  `${formatStarsFull(item.stars)} · 所属仓库星数，查询于 ${item.stars_date}`;

/** 首字母色块的两个字母：ArXiv MCP Server → Ar，pdf → Pd */
export function initials(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '');
  const s = letters || name;
  return s.charAt(0).toUpperCase() + (s.charAt(1) || '').toLowerCase();
}

/** 色块颜色：按条目在 registry 中的序号轮换 8 种（tokens.css --logo-1…8） */
export const logoColor = (index: number) => `var(--logo-${(((index % 8) + 8) % 8) + 1})`;

/** 搜索：名称、作者、描述、类别；忽略大小写，中英文都按子串匹配 */
export function matchesQuery(item: Pick<MarketItem, 'name' | 'owner' | 'desc_zh' | 'category'>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [item.name, item.owner, item.desc_zh, item.category].some((f) => f.toLowerCase().includes(needle));
}

/** 类别清单＝当前数据中出现的 category 去重，按首次出现顺序（规格 2-市场页-类别筛选） */
export function categoriesOf(items: Pick<MarketItem, 'category'>[]): string[] {
  return [...new Set(items.map((i) => i.category))];
}

export function sortItems<T extends Pick<MarketItem, 'stars' | 'name'>>(items: T[], sort: SortKey): T[] {
  if (sort === 'recommended') return items; // registry 原顺序
  const copy = [...items];
  if (sort === 'stars') return copy.sort((a, b) => b.stars - a.stars);
  return copy.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function filterItems<T extends MarketItem>(items: T[], q: string, category: string | null, sort: SortKey): T[] {
  return sortItems(
    items.filter((i) => matchesQuery(i, q) && (!category || i.category === category)),
    sort,
  );
}

/** 权限代码的中文名（plugin-manifest.md 的 4 种权限） */
export const PERMISSION_LABEL: Record<InstalledPlugin['permissions'][number], string> = {
  network: '联网',
  fs_read: '读文件',
  fs_write: '写文件',
  exec: '执行本机命令',
};
export const PERMISSION_DOT: Record<InstalledPlugin['permissions'][number], string> = {
  network: 'var(--perm-network)',
  fs_read: 'var(--perm-fs)',
  fs_write: 'var(--perm-fs)',
  exec: 'var(--perm-exec)',
};
/** 权限卡最后一行（规格 3-条目卡片-插件详情页「交互细则」，固定文案） */
export const PERMISSION_NOTE = '以上为插件自行声明，第一版不做沙箱隔离';

/**
 * v1 完整验收的插件（plugin-manifest.md：只做 ArXiv MCP Server 与 Fetch MCP Server）。
 * 详情页用 `PluginDetail.verified`；市场卡片的 `MarketItem` 没有这个字段，暂用本常量（未决 U29）。
 */
export const V1_VERIFIED_PLUGINS: readonly string[] = ['arxiv', 'fetch'];

/** 显示用的仓库地址去掉协议，用于来源卡：github.com/blazickjp/arxiv-mcp-server */
export const displayRepo = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** Skill 附带脚本的判断：按扩展名（规格 3-条目卡片-Skill详情页：脚本标“不执行”） */
export const isScriptFile = (path: string) => /\.(py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl|ps1|bat|cmd)$/i.test(path);
