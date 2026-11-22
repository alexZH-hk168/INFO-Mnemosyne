// 极简路由：只解析规格 1-启动-应用外壳 列出的 5 种路径，用 history API，不引入路由库。
// 路由变化只改 store，不重新挂载四栏（规格「交互细则」）。
import type { ID } from '../api/types';
import type { MarketRoute } from '../store/layout';

export type Route =
  { name: 'home' } | { name: 'conversation'; cid: ID; bid?: ID } | { name: 'market'; market: MarketRoute };

const MARKET_TABS = ['plugins', 'skills', 'installed'] as const;

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'c' && parts[1]) {
    if (parts[2] === 'b' && parts[3]) return { name: 'conversation', cid: parts[1], bid: parts[3] };
    return { name: 'conversation', cid: parts[1] };
  }
  if (parts[0] === 'market') {
    if ((parts[1] === 'plugin' || parts[1] === 'skill') && parts[2]) {
      const tab = parts[1] === 'plugin' ? 'plugins' : 'skills';
      return { name: 'market', market: { tab, detail: { type: parts[1], id: parts[2] } } };
    }
    const tab = (MARKET_TABS as readonly string[]).includes(parts[1] ?? '')
      ? (parts[1] as MarketRoute['tab'])
      : 'plugins';
    return { name: 'market', market: { tab } };
  }
  return { name: 'home' };
}

export function routePath(r: Route): string {
  const e = encodeURIComponent;
  switch (r.name) {
    case 'home':
      return '/';
    case 'conversation':
      return r.bid ? `/c/${e(r.cid)}/b/${e(r.bid)}` : `/c/${e(r.cid)}`;
    case 'market':
      return r.market.detail ? `/market/${r.market.detail.type}/${e(r.market.detail.id)}` : `/market/${r.market.tab}`;
  }
}

/** 推入新地址（同址不重复推）；不触发 popstate，调用方自己改 store */
export function pushPath(path: string): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path);
}
