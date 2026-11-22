// 规格：1-助手回答-重新生成与切换（chat.regenerate）
// 回答底部悬停或聚焦时出现：复制（去掉 [[E#]] 的纯文本）、重新生成；存在兄弟回答（同一 parent_id 的 assistant）时显示“‹ 1/2 ›”。
// 重新生成：POST /api/messages/{mid}/regenerate（SSE），新回答是兄弟节点并切换过去；生成中禁用。
// 切换：PUT /api/conversations/{cid}/active_leaf，失效 ['tree', cid]。概念图缺口：无概念图。
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { memo } from 'react';
import { api } from '../api/client';
import type { ActiveLeafResult } from '../api/endpoints';
import { queryKeys } from '../api/queries';
import type { ID } from '../api/types';
import { ChevronIcon, CopyIcon, RegenerateIcon } from '../icons/ChatIcons';
import { stripCitations } from '../lib/citations';
import { useChat } from '../store/chat';
import { useUI } from '../store/ui';

interface Props {
  conversationId: ID;
  messageId: ID;
  parentId?: ID;
  content: string;
  /** 兄弟回答（含自己），按创建时间排序 */
  siblings: ID[];
  /** 有回合在生成中 */
  busy: boolean;
  /** 始终显示（如出错、重连失败时） */
  pinned?: boolean;
  /** 不提供复制（如没有正文） */
  canCopy?: boolean;
}

function MessageActions({
  conversationId,
  messageId,
  parentId,
  content,
  siblings,
  busy,
  pinned,
  canCopy = true,
}: Props) {
  const qc = useQueryClient();
  const idx = siblings.indexOf(messageId);
  const switchTo = useMutation({
    mutationFn: (target: ID) =>
      api.put<ActiveLeafResult>(`/api/conversations/${encodeURIComponent(conversationId)}/active_leaf`, {
        message_id: target,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.tree(conversationId) }),
    onError: (e) => useUI.getState().pushToast({ kind: 'error', text: `切换失败：${(e as Error).message}` }),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stripCitations(content));
      useUI.getState().pushToast({ kind: 'success', text: '已复制' });
    } catch {
      useUI.getState().pushToast({ kind: 'error', text: '复制失败：浏览器没有授权剪贴板' });
    }
  };

  const regenerate = () => {
    const target: { conversation_id: ID; parent_id?: ID } = { conversation_id: conversationId };
    if (parentId) target.parent_id = parentId;
    useChat.getState().regenerate(messageId, target);
  };

  const btn =
    'mn-focus grid h-7 w-7 place-items-center rounded-btn-sm text-muted hover:bg-sel hover:text-ink disabled:text-faint disabled:hover:bg-transparent';
  return (
    <div
      data-testid={`chat.regenerate.bar:${messageId}`}
      className={`mt-2 flex items-center gap-0.5 transition-opacity ${
        pinned ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
      }`}
    >
      {canCopy && (
        <button
          type="button"
          data-testid={`chat.regenerate.copy:${messageId}`}
          aria-label="复制"
          title="复制"
          onClick={() => void copy()}
          className={btn}
        >
          <CopyIcon size={15} />
        </button>
      )}
      <button
        type="button"
        data-testid={`chat.regenerate:${messageId}`}
        aria-label="重新生成"
        title="重新生成"
        disabled={busy}
        onClick={regenerate}
        className={btn}
      >
        <RegenerateIcon size={15} />
      </button>
      {siblings.length > 1 && idx >= 0 && (
        <span className="ml-1 inline-flex items-center text-[12px] text-muted">
          <button
            type="button"
            data-testid={`chat.regenerate.prev:${messageId}`}
            aria-label="上一个回答"
            disabled={busy || idx === 0 || switchTo.isPending}
            onClick={() => switchTo.mutate(siblings[idx - 1])}
            className={btn}
          >
            <ChevronIcon dir="left" size={14} />
          </button>
          <span data-testid={`chat.regenerate.count:${messageId}`} className="min-w-[28px] text-center tabular-nums">
            {idx + 1}/{siblings.length}
          </span>
          <button
            type="button"
            data-testid={`chat.regenerate.next:${messageId}`}
            aria-label="下一个回答"
            disabled={busy || idx === siblings.length - 1 || switchTo.isPending}
            onClick={() => switchTo.mutate(siblings[idx + 1])}
            className={btn}
          >
            <ChevronIcon dir="right" size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

export default memo(MessageActions);
