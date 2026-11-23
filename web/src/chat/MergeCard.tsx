// 规格：1-消息列表-合并卡片（chat.merge-card）
// 分支合并后主线末尾插入的卡片：“来自分支：<标题>”＋要点摘要（收起时 3 行），可展开在卡片内只读查看分支全部消息；
// “打开分支”在右栏打开该分支。要点里的证据胶囊照常可点。无概念图（U7：实现后截图交用户确认）。
import { memo, useId, useState } from 'react';
import type { Branch, ConversationTree, Message } from '../api/types';
import { openBranchTab } from '../branch/actions';
import { LeafContext } from '../branch/leafContext';
import { branchLeaf, branchPath } from '../branch/model';
import { BranchIcon } from '../icons/Icons';
import { ChevronIcon } from '../icons/ChatIcons';
import AnswerBody from './AnswerBody';

interface Props {
  message: Message;
  tree: ConversationTree;
}

/** 合并卡片对应的分支：merged_into_message_id 指向本消息 */
export const branchOfNote = (tree: ConversationTree, noteId: string): Branch | undefined =>
  tree.branches.find((b) => b.merged_into_message_id === noteId);

function MergeCard({ message, tree }: Props) {
  const [open, setOpen] = useState(false);
  const branch = branchOfNote(tree, message.id);
  const listId = useId();
  const msgs = open && branch ? branchPath(tree, branch.id) : [];

  return (
    <div
      data-testid={`chat.merge-card:${message.id}`}
      data-state={open ? 'open' : 'closed'}
      className="rounded-card border border-line bg-surface px-4 py-3"
    >
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <BranchIcon size={14} />
        <span className="min-w-0 flex-1 truncate">
          来自分支：<span className="font-medium text-ink-2">{branch?.title ?? '已合并的分支'}</span>
        </span>
        {branch && (
          <button
            type="button"
            data-testid={`chat.merge-card.open:${message.id}`}
            onClick={() => openBranchTab(branch)}
            className="mn-focus flex-none rounded-btn-sm px-1.5 py-0.5 text-ink-2 hover:bg-sel hover:text-ink"
          >
            打开分支
          </button>
        )}
      </div>
      <div
        data-testid={`chat.merge-card.summary:${message.id}`}
        className={`mt-1.5 text-[14px] leading-[1.75] text-ink ${open ? '' : 'line-clamp-3'}`}
      >
        <AnswerBody
          messageId={message.id}
          content={message.content}
          citations={message.citations ?? []}
          streaming={false}
        />
      </div>
      {branch && (
        <button
          type="button"
          data-testid={`chat.merge-card.toggle:${message.id}`}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className="mn-focus mt-1.5 inline-flex items-center gap-1 rounded-btn-sm px-1 py-0.5 text-[12.5px] text-muted hover:text-ink"
        >
          <ChevronIcon dir={open ? 'up' : 'down'} size={13} />
          {open ? '收起' : '展开分支全文'}
        </button>
      )}
      {open && branch && (
        <LeafContext.Provider value={branchLeaf(tree, branch)}>
          <ol
            id={listId}
            data-testid={`chat.merge-card.list:${message.id}`}
            className="mt-2 space-y-3 border-t border-line-2 pt-3"
          >
            {msgs.map((m) => (
              <li key={m.id} data-testid={`chat.merge-card.item:${m.id}`} data-role={m.role}>
                {m.role === 'user' ? (
                  <div className="ml-auto w-fit max-w-[88%] rounded-[14px] bg-panel-2 px-3 py-1.5 text-[13.5px] leading-[1.7] text-ink">
                    {m.content}
                  </div>
                ) : (
                  <div className="text-[13.5px] leading-[1.75]">
                    <AnswerBody messageId={m.id} content={m.content} citations={m.citations ?? []} streaming={false} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </LeafContext.Provider>
      )}
    </div>
  );
}

export default memo(MergeCard);
