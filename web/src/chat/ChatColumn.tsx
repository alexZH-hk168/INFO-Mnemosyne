// 规格：1-对话行-对话栏（chat.panel）＋ 1-对话栏-流式连接（chat.stream-client，客户端在 api/sse.ts）
// 中间区显示一段对话：头部（标题；“主线 · N 个分支”标签由 F5 的 ChatHeader 实现，挂载点 BranchOverviewSlot）、消息列表、底部输入框（variant=chat）。
// F5 追加：主线回答的划词工具条（SelectionToolbar）挂在这里。
// 只渲染主线路径（根 → active_leaf）。加载中 3 段消息骨架；NOT_FOUND 显示“对话不存在或已删除”与“回到主页”。
// 头部右侧的搜索、分享、更多图标 v1 不做。回答结束（saved/cancelled/error）后失效 ['tree', cid]、['conversations', pid]、['documents', pid]。
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { ApiRequestError } from '../api/client';
import { queryKeys, useDocuments, useTree } from '../api/queries';
import type { ConversationTree, ID } from '../api/types';
import { goHome } from '../lib/nav';
import { useChat } from '../store/chat';
import Composer from './Composer';
import EvidenceHover from './EvidenceHover';
import BranchOverview from './ChatHeader';
import MessageList from './MessageList';
import SelectionToolbar from './SelectionToolbar';
import './chat.css';

/** F5 挂载点：1-对话栏-分支概览标签（“主线 · 2 个分支”） */
export function BranchOverviewSlot({ tree }: { tree: ConversationTree }) {
  return <BranchOverview tree={tree} />;
}

function Skeleton() {
  return (
    <div
      data-testid="chat.panel.loading"
      className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pt-6"
      aria-busy="true"
    >
      <div className="mn-skel ml-auto h-12 w-[62%] rounded-[16px]" />
      <div className="space-y-2.5">
        <div className="mn-skel h-8 w-full rounded-card" />
        <div className="mn-skel h-3.5 w-[92%]" />
        <div className="mn-skel h-3.5 w-[84%]" />
        <div className="mn-skel h-3.5 w-[60%]" />
      </div>
      <div className="mn-skel ml-auto h-10 w-[45%] rounded-[16px]" />
    </div>
  );
}

export default function ChatColumn() {
  const cid = useChat((s) => s.conversationId);
  const projectId = useChat((s) => s.projectId);
  const streaming = useChat((s) => s.streaming);
  const turn = useChat((s) => s.turn);
  const tree = useTree(cid);
  const docs = useDocuments(projectId);
  const qc = useQueryClient();

  const docTitles = useMemo(
    () => (docs.data?.groups ?? []).flatMap((g) => g.documents.filter((d) => d.kind !== 'web').map((d) => d.title)),
    [docs.data],
  );

  // 回答结束：刷新树（拿到入库后的消息与 active_leaf）、对话列表（标题/时间）、文件栏（新的网页快照）
  const endKey = streaming && turn ? `${streaming.message_id}:${streaming.status}` : '';
  useEffect(() => {
    if (!streaming || !turn) return;
    if (streaming.status !== 'saved' && streaming.status !== 'cancelled' && streaming.status !== 'error') return;
    void qc.invalidateQueries({ queryKey: queryKeys.tree(turn.conversation_id) });
    const pid = useChat.getState().projectId;
    if (pid) {
      void qc.invalidateQueries({ queryKey: queryKeys.conversations(pid) });
      void qc.invalidateQueries({ queryKey: queryKeys.documents(pid) });
      // INT1：项目栏的对话数（Project.conversation_count）在新对话首轮后变化
      void qc.invalidateQueries({ queryKey: queryKeys.projects() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endKey]);

  if (!cid) return null;
  const notFound = tree.error instanceof ApiRequestError && tree.error.code === 'NOT_FOUND';

  // 新消息接在哪条后面：刚结束、树还没刷新时用流式回答的 id
  let leaf: ID | undefined = tree.data
    ? (tree.data.active_leaf_id ?? tree.data.conversation.active_leaf_id)
    : undefined;
  if (
    turn &&
    !turn.branch_id &&
    turn.conversation_id === cid &&
    streaming &&
    (streaming.status === 'saved' || streaming.status === 'cancelled') &&
    tree.data &&
    !tree.data.messages.some((m) => m.id === streaming.message_id)
  ) {
    leaf = streaming.message_id;
  }

  return (
    <section data-testid="chat.panel" data-cid={cid} className="flex h-full min-w-0 flex-col bg-canvas">
      <header className="flex h-[52px] flex-none items-center gap-2.5 px-6">
        <h1 data-testid="chat.panel.title" className="min-w-0 truncate text-[15px] font-semibold text-ink">
          {tree.data?.conversation.title.trim() || (tree.isLoading ? '' : '新对话')}
        </h1>
        {tree.data && <BranchOverviewSlot tree={tree.data} />}
      </header>
      {notFound ? (
        <div
          data-testid="chat.panel.not-found"
          className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
        >
          <div className="text-[15px] text-ink-2">对话不存在或已删除</div>
          <button
            type="button"
            data-testid="chat.panel.go-home"
            onClick={goHome}
            className="mn-focus rounded-btn border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2 hover:text-ink"
          >
            回到主页
          </button>
        </div>
      ) : tree.data ? (
        <MessageList conversationId={cid} tree={tree.data} docTitles={docTitles} />
      ) : tree.isError ? (
        <div data-testid="chat.panel.error" className="flex flex-1 items-center justify-center text-[13px] text-danger">
          读取对话失败：{(tree.error as Error).message}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <Skeleton />
        </div>
      )}
      {!notFound && (
        <div className="flex-none px-6 pb-4 pt-1">
          <div className="mx-auto max-w-[720px]">
            <Composer variant="chat" conversationId={cid} parentId={leaf} />
          </div>
        </div>
      )}
      <EvidenceHover />
      {tree.data && <SelectionToolbar conversationId={cid} tree={tree.data} />}
    </section>
  );
}
