// 规格：2-分支面板-来源原句与回到原处（right.branch-anchor）
// 分支顶部引用块：“⑂ 分支自主线 · 第 N 条回答”＋锚点原句，右上“回到原处 ›”。
// 回到原处：对话栏滚动到 fork 消息并闪烁高亮锚点 1.2 s；fork 消息不在当前主线（兄弟回答已切换）时先切换 active_leaf 再滚动。
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Branch } from '../api/types';
import { ChevronIcon } from '../icons/ChatIcons';
import { BranchIcon } from '../icons/Icons';
import { useUI } from '../store/ui';
import { goToAnchor } from './actions';

export default function AnchorQuote({ branch, ordinal }: { branch: Branch; ordinal: number }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const back = async () => {
    setBusy(true);
    try {
      await goToAnchor(qc, branch);
    } catch (err) {
      useUI.getState().pushToast({ kind: 'error', text: `回到原处失败：${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="right.branch-anchor" className="rounded-r-btn border-l-[3px] border-line bg-panel px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <BranchIcon size={13} />
        <span className="min-w-0 flex-1 truncate">分支自主线{ordinal > 0 ? ` · 第 ${ordinal} 条回答` : ''}</span>
        <button
          type="button"
          data-testid="right.branch-anchor.back"
          aria-busy={busy || undefined}
          onClick={() => void back()}
          className="mn-focus inline-flex flex-none items-center gap-0.5 rounded-btn-sm px-1 py-0.5 text-ink-2 hover:bg-sel hover:text-ink"
        >
          回到原处
          <ChevronIcon dir="right" size={12} />
        </button>
      </div>
      <p data-testid="right.branch-anchor.quote" className="mt-1 text-[13.5px] leading-[1.7] text-ink-2">
        “{branch.anchor_quote}”
      </p>
    </div>
  );
}
