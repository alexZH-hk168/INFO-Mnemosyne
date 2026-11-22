// 中间区：按 useLayout.view 切换（规格 1-启动-应用外壳「渲染中间区」）。
// view=home 的主页由 F2 提供 web/src/home/Onboard.tsx，合并时由编排 Agent 接到 HomeSlot 这一处；
// conversation（F3 对话栏）与 market（F6 市场页）同样先放占位。
import { useLayout } from '../store/layout';

function Placeholder({ testid, title, note }: { testid: string; title: string; note: string }) {
  return (
    <div data-testid={testid} className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
      <div className="font-serif text-[22px] font-semibold text-ink-2">{title}</div>
      <div className="text-[12.5px] text-faint">{note}</div>
    </div>
  );
}

/** 主页插槽：F2 合并时把这里换成 <Onboard />，其余代码不用动 */
function HomeSlot() {
  return <Placeholder testid="center.home-placeholder" title="主页" note="占位：F2 实现（web/src/home/Onboard.tsx）" />;
}

export default function CenterPane() {
  const view = useLayout((s) => s.view);
  return (
    <main data-testid="center.pane" data-view={view} className="relative h-full min-w-0 flex-1 overflow-hidden">
      {view === 'home' && <HomeSlot />}
      {view === 'conversation' && (
        <Placeholder testid="center.conversation-placeholder" title="对话栏" note="占位：F3 实现" />
      )}
      {view === 'market' && (
        <Placeholder testid="center.market-placeholder" title="插件与 Skill" note="占位：F6 实现" />
      )}
    </main>
  );
}
