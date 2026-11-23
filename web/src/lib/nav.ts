// 导航动作：同时改 store 与地址栏。各规格「下一级」表写的 store action + 路由都经这里。
import type { ID } from '../api/types';
import { requestComposerFocus } from '../chat/focus';
import { useChat } from '../store/chat';
import { useEvidence } from '../store/evidence';
import { useLayout, type MarketRoute } from '../store/layout';
import { parseRoute, pushPath, routePath, type Route } from './router';

/**
 * INT2（U113 ③，编排决定）：离开对话回到主页（conversationId 从有变为 null，含“新建对话”、浏览器后退到 `/`）时，
 * 关掉右栏的分支标签——分支面板属于上一段对话，主页不应继续显示。没有其他标签时右栏按 U40 自动收起。
 * 只在回主页时关；对话 A 切到对话 B 仍保留（F5 允许分支标签来自别的对话，见 branch/actions.findBranchTree）。
 * 材料预览标签（PDF 等）属于项目，不关；但清掉“当前选中证据”，否则主页上的 PDF 标签顶上会留着上一段对话的证据栏（序号算不出，显示“证据 ?”）。
 */
export function closeBranchTabs(): void {
  const layout = useLayout.getState();
  for (const t of layout.rightTabs.filter((x) => x.kind === 'branch')) useLayout.getState().closeTab(t.id);
  useEvidence.setState({
    selectedEvidenceId: null,
    selectedMessageId: null,
    selectedLeafId: null,
    messageEvidence: [],
  });
}
useChat.subscribe((s, prev) => {
  if (prev.conversationId && !s.conversationId) closeBranchTabs();
});

/** 新建对话 / 回主页：setConversation(null)、view=home、路由 `/`；主页输入框获得焦点（F3，U23） */
export function goHome(): void {
  useChat.getState().setConversation(null);
  useLayout.getState().setView('home');
  pushPath('/');
  requestComposerFocus('home');
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
