// 导航动作：同时改 store 与地址栏。各规格「下一级」表写的 store action + 路由都经这里。
import type { ID } from '../api/types';
import { useChat } from '../store/chat';
import { useLayout, type MarketRoute } from '../store/layout';
import { parseRoute, pushPath, routePath, type Route } from './router';

/** 新建对话 / 回主页：setConversation(null)、view=home、路由 `/` */
export function goHome(): void {
  useChat.getState().setConversation(null);
  useLayout.getState().setView('home');
  pushPath('/');
}

/** 打开对话主线：setConversation(cid)、view=conversation、路由 `/c/:cid` */
export function goConversation(cid: ID): void {
  useChat.getState().setConversation(cid);
  useLayout.getState().setView('conversation');
  pushPath(routePath({ name: 'conversation', cid }));
}

/** 市场页：view=market、marketRoute、路由 `/market/:tab` */
export function goMarket(route: MarketRoute = { tab: 'plugins' }): void {
  useLayout.getState().setMarketRoute(route);
  useLayout.getState().setView('market');
  pushPath(routePath({ name: 'market', market: route }));
}

/** 把一个已解析的地址写进 store（启动与浏览器前进后退时调用） */
export function applyRoute(r: Route): void {
  const chat = useChat.getState();
  const layout = useLayout.getState();
  switch (r.name) {
    case 'home':
      chat.setConversation(null);
      layout.setView('home');
      break;
    case 'conversation':
      if (chat.conversationId !== r.cid) chat.setConversation(r.cid);
      chat.setActiveBranch(r.bid ?? null);
      layout.setView('conversation');
      break;
    case 'market':
      layout.setMarketRoute(r.market);
      layout.setView('market');
      break;
  }
}

export function currentRoute(): Route {
  return parseRoute(typeof window === 'undefined' ? '/' : window.location.pathname);
}
