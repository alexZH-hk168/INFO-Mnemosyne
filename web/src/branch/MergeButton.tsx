// 规格：2-分支面板-要点合并按钮（right.branch-merge）
// “要点合并到主线”：分支 open 且至少有一轮问答时出现。点击先确认（文案见规格），确认后 POST /api/branches/{bid}/merge，
// 主线末尾出现合并卡片并滚到底部，分支变只读；失效 ['tree', cid]。合并中按钮转圈；失败提示条，可重试。
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Branch } from '../api/types';
import { MergeIcon } from '../icons/BranchIcons';
import { Spinner } from '../icons/Icons';
import { useUI } from '../store/ui';
import { mergeBranch, scrollChatTo } from './actions';

export const MERGE_CONFIRM = '合并后，这个分支里的要点和记忆对主线可见，分支变为只读。';

export default function MergeButton({ branch }: { branch: Branch }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [merging, setMerging] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirm) return;
    box.current?.querySelector<HTMLElement>('[data-testid="right.branch-merge.confirm"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setConfirm(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [confirm]);

  const close = () => {
    setConfirm(false);
    btn.current?.focus();
  };

  const run = async () => {
    setConfirm(false);
    setMerging(true);
    try {
      const res = await mergeBranch(qc, branch);
      void scrollChatTo(`[data-testid="chat.merge-card:${CSS.escape(res.merge_note.id)}"]`, 'end');
    } catch (err) {
      useUI.getState().pushToast({
        kind: 'error',
        text: `合并失败：${(err as Error).message}`,
        action: { label: '重试', onClick: () => void run() },
      });
    } finally {
      setMerging(false);
    }
  };

  // 焦点在确认框内循环（确认 / 取消），Esc 关闭并回到按钮
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const items = Array.from(box.current?.querySelectorAll<HTMLElement>('button') ?? []);
      const i = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className="relative flex-none">
      <button
        ref={btn}
        type="button"
        data-testid="right.branch-merge"
        data-state={merging ? 'merging' : 'idle'}
        aria-haspopup="dialog"
        aria-expanded={confirm}
        disabled={merging}
        onClick={() => setConfirm((v) => !v)}
        className="mn-focus inline-flex items-center gap-1.5 rounded-btn border border-line bg-surface px-2.5 py-1 text-[12.5px] font-medium text-ink-2 hover:text-ink disabled:opacity-70"
      >
        {merging ? <Spinner size={13} /> : <MergeIcon size={14} />}
        要点合并到主线
      </button>
      {confirm && (
        <div
          ref={box}
          role="alertdialog"
          aria-modal="false"
          aria-label="合并到主线"
          aria-describedby="mn-merge-confirm-text"
          data-testid="right.branch-merge.dialog"
          onKeyDown={onKey}
          className="absolute bottom-[calc(100%+8px)] right-0 z-30 w-[280px] rounded-card-sm border border-line bg-surface p-3 shadow-[var(--shadow-pop)]"
        >
          <p id="mn-merge-confirm-text" className="text-[12.8px] leading-[1.65] text-ink-2">
            {MERGE_CONFIRM}
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              data-testid="right.branch-merge.cancel"
              onClick={close}
              className="mn-focus rounded-btn-sm px-2.5 py-1 text-[12.5px] text-ink-2 hover:bg-sel"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="right.branch-merge.confirm"
              onClick={() => void run()}
              className="mn-focus rounded-btn-sm bg-ink px-2.5 py-1 text-[12.5px] font-medium text-surface"
            >
              合并
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
