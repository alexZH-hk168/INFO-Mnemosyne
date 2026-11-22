// 中间区：按 useLayout.view 切换（规格 1-启动-应用外壳「渲染中间区」）。
// view=home 渲染 F2 的主页 Onboard（web/src/home）；view=market 渲染 F6 的市场页（web/src/market）；
// conversation（F3 对话栏）先放占位。
import { useLayout } from '../store/layout';
import { Onboard } from '../home';
import { MarketPage } from '../market';

function Placeholder({ testid, title, note }: { testid: string; title: string; note: string }) {
  return (
    <div data-testid={testid} className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
      <div className="font-serif text-[22px] font-semibold text-ink-2">{title}</div>
      <div className="text-[12.5px] text-faint">{note}</div>
    </div>
  );
}

/** 主页插槽：F2 的 Onboard（编排合并时接入） */
function HomeSlot() {
  return <Onboard />;
}

export default function CenterPane() {
  const view = useLayout((s) => s.view);
  return (
    <main data-testid="center.pane" data-view={view} className="relative h-full min-w-0 flex-1 overflow-hidden">
      {view === 'home' && <HomeSlot />}
      {view === 'conversation' && (
        <Placeholder testid="center.conversation-placeholder" title="对话栏" note="占位：F3 实现" />
      )}
      {view === 'market' && <MarketPage />}
    </main>
  );
}
