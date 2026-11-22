// 中间区：按 useLayout.view 切换（规格 1-启动-应用外壳「渲染中间区」）。
// view=home 渲染 F2 的主页 Onboard（web/src/home）；conversation 渲染 F3 的对话栏（web/src/chat/ChatColumn）；
// view=market 渲染 F6 的市场页（web/src/market）。
import ChatColumn from '../chat/ChatColumn';
import { useLayout } from '../store/layout';
import { Onboard } from '../home';
import { MarketPage } from '../market';

/** 主页插槽：F2 的 Onboard（编排合并时接入） */
function HomeSlot() {
  return <Onboard />;
}

export default function CenterPane() {
  const view = useLayout((s) => s.view);
  return (
    <main data-testid="center.pane" data-view={view} className="relative h-full min-w-0 flex-1 overflow-hidden">
      {view === 'home' && <HomeSlot />}
      {view === 'conversation' && <ChatColumn />}
      {view === 'market' && <MarketPage />}
    </main>
  );
}
