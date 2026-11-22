// 市场页的地址：路径 `/market/:tab`、`/market/:type/:id`（lib/router.ts 已解析），查询串 `?q=&cat=&sort=`（本文件）。
// 规格：2-市场页-标签切换（保留搜索词、清空类别）、2-市场页-搜索框（?q=）、2-市场页-类别筛选（?cat=）、2-市场页-排序（?sort=）。
import { useCallback, useEffect, useState } from 'react';
import { goMarket } from '../lib/nav';
import { routePath } from '../lib/router';
import { useLayout, type MarketRoute } from '../store/layout';
import { isSortKey, type SortKey } from './format';

export interface MarketParams {
  q: string;
  cat: string | null;
  sort: SortKey;
}

export function readParams(search = typeof window === 'undefined' ? '' : window.location.search): MarketParams {
  const sp = new URLSearchParams(search);
  const sort = sp.get('sort');
  return { q: sp.get('q') ?? '', cat: sp.get('cat') || null, sort: isSortKey(sort) ? sort : 'recommended' };
}

export function paramsSearch(p: MarketParams): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  if (p.cat) sp.set('cat', p.cat);
  if (p.sort !== 'recommended') sp.set('sort', p.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** 列表页最近一次的查询串：从详情页回到列表时恢复（面包屑） */
let lastListSearch = '';

/** 切换标签：保留搜索词与排序，清空类别；改路由 `/market/:tab` */
export function goMarketTab(tab: MarketRoute['tab']): void {
  const cur = readParams();
  const search = paramsSearch({ ...cur, cat: null });
  const route: MarketRoute = { tab };
  useLayout.getState().setMarketRoute(route);
  useLayout.getState().setView('market');
  const path = routePath({ name: 'market', market: route }) + search;
  if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState(null, '', path);
  lastListSearch = search;
}

/** 进入详情：`marketRoute.detail={type,id}`、路由 `/market/:type/:id` */
export function openDetail(type: 'plugin' | 'skill', id: string): void {
  const cur = useLayout.getState().marketRoute;
  if (!cur.detail) lastListSearch = window.location.search;
  goMarket({ tab: cur.tab, detail: { type, id } });
}

/** 面包屑回列表：`marketRoute.detail=undefined` */
export function backToList(tab?: MarketRoute['tab']): void {
  const cur = useLayout.getState().marketRoute;
  const route: MarketRoute = { tab: tab ?? cur.tab };
  useLayout.getState().setMarketRoute(route);
  useLayout.getState().setView('market');
  window.history.pushState(null, '', routePath({ name: 'market', market: route }) + lastListSearch);
}

/** 列表页的 q / cat / sort：初值取地址栏，变化时用 replaceState 写回；浏览器前进后退时重新读取 */
export function useMarketParams(): [MarketParams, (patch: Partial<MarketParams>) => void] {
  const [params, setParams] = useState<MarketParams>(() => readParams());
  useEffect(() => {
    const onPop = () => setParams(readParams());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const update = useCallback((patch: Partial<MarketParams>) => {
    setParams((prev) => {
      const next = { ...prev, ...patch };
      const search = paramsSearch(next);
      if (window.location.search !== search) {
        window.history.replaceState(null, '', `${window.location.pathname}${search}`);
      }
      lastListSearch = search;
      return next;
    });
  }, []);
  return [params, update];
}
