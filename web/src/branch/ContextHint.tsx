// 规格：2-分支面板-上下文提示（right.branch-context）
// 分支输入框上方灰字“上下文：主线前 N 轮 + 本分支”，N = Branch.context_turns；悬停（或键盘聚焦）说明“分支看不到锚点之后的主线和其他分支。”
import { useId } from 'react';
import { LayersIcon } from '../icons/ChatIcons';

export const CONTEXT_TIP = '分支看不到锚点之后的主线和其他分支。';

export default function ContextHint({ turns }: { turns: number }) {
  const tipId = useId();
  return (
    <span
      data-testid="right.branch-context"
      data-turns={turns}
      tabIndex={0}
      aria-describedby={tipId}
      className="mn-focus group relative inline-flex min-w-0 items-center gap-1.5 rounded-btn-sm text-[12px] text-muted"
    >
      <LayersIcon size={13} />
      <span className="truncate">上下文：主线前 {turns} 轮 + 本分支</span>
      <span
        id={tipId}
        role="tooltip"
        data-testid="right.branch-context.tip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-0 z-20 hidden w-max max-w-[260px] rounded-btn-sm bg-ink px-2 py-1 text-[11.5px] leading-[1.5] text-surface shadow-[var(--shadow-pop)] group-hover:block group-focus-visible:block"
      >
        {CONTEXT_TIP}
      </span>
    </span>
  );
}
