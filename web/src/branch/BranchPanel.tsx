// 规格：2-开分支追问-分支面板（right.branch-panel）
// 右栏里的一段分支对话：顶部来源原句与“回到原处”（AnchorQuote），中间分支消息，底部上下文提示（ContextHint）、
// “要点合并到主线”（MergeButton）与分支输入框（Composer variant="branch"）。
// - 分支消息 = ['tree', cid] 里 branch_id 等于本分支的消息（从 fork 消息往下的路径）；分支里的进行中一轮叠在末尾。
// - 面板激活（挂载）时 useChat.activeBranchId = 本分支、路由 /c/:cid/b/:bid；切到别的标签或关闭（卸载）时恢复 null、路由回 /c/:cid。
// - 分支内发送的请求体带 branch_id（Composer 按 variant="branch" 填）；证据可见性按分支叶子（LeafContext → leaf_id，U44）。
// - 状态：新分支无消息 → 输入框聚焦，占位“就这句话追问…”；merged → 顶部“已合并到主线”、输入框只读；archived → 只读。
// - 分支里证据胶囊点击在右栏新开预览标签，不替换分支标签（openTab 按 kind+ref_id 区分）；划词在分支内开分支 v1 不支持。
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useDocuments, useTree } from '../api/queries';
import type { ID } from '../api/types';
import AssistantMessage, { type AssistantView } from '../chat/AssistantMessage';
import Composer from '../chat/Composer';
import UserMessage from '../chat/UserMessage';
import { historyLatencyMs } from '../lib/latency';
import { pushPath, routePath } from '../lib/router';
import { useChat } from '../store/chat';
import { useLayout, type Tab } from '../store/layout';
import AnchorQuote from './AnchorQuote';
import ContextHint from './ContextHint';
import { findBranchTree } from './actions';
import { LeafContext } from './leafContext';
import MergeButton from './MergeButton';
import { branchPath, forkOrdinal } from './model';

export const NEW_BRANCH_PLACEHOLDER = '就这句话追问…';

export default function BranchPanel({ tab }: { tab: Tab }) {
  const bid = tab.ref_id;
  const qc = useQueryClient();
  const currentCid = useChat((s) => s.conversationId);
  // 分支标签可能来自别的对话：先在已缓存的树里找，找不到按当前对话
  const cid = findBranchTree(qc, bid)?.conversation.id ?? currentCid;
  const tree = useTree(cid);
  const projectId = useChat((s) => s.projectId);
  const docs = useDocuments(projectId);
  const turn = useChat((s) => s.turn);
  const streaming = useChat((s) => s.streaming);
  const settleTurn = useChat((s) => s.settleTurn);
  const scroller = useRef<HTMLDivElement>(null);

  const branch = tree.data?.branches.find((b) => b.id === bid);
  const branchCid = branch?.conversation_id ?? null;

  // 激活：activeBranchId 与路由；卸载（切走/关闭）时恢复
  useEffect(() => {
    if (!branchCid) return;
    const chat = useChat.getState();
    const mine = chat.conversationId === branchCid;
    const here = routePath({ name: 'conversation', cid: branchCid, bid });
    if (mine) {
      chat.setActiveBranch(bid);
      if (useLayout.getState().view === 'conversation') pushPath(here);
    }
    return () => {
      const c = useChat.getState();
      if (c.activeBranchId === bid) c.setActiveBranch(null);
      if (typeof window !== 'undefined' && window.location.pathname === here)
        pushPath(routePath({ name: 'conversation', cid: branchCid }));
    };
  }, [bid, branchCid]);

  const docTitles = useMemo(
    () => (docs.data?.groups ?? []).flatMap((g) => g.documents.filter((d) => d.kind !== 'web').map((d) => d.title)),
    [docs.data],
  );
  const path = useMemo(() => (tree.data ? branchPath(tree.data, bid) : []), [tree.data, bid]);
  const inTree = useMemo(() => new Set(tree.data?.messages.map((m) => m.id) ?? []), [tree.data]);
  const byId = useMemo(() => new Map(tree.data?.messages.map((m) => [m.id, m]) ?? []), [tree.data]);

  // 本分支的进行中一轮
  const myTurn = turn && turn.conversation_id === cid && turn.branch_id === bid ? turn : null;
  const settled = !!myTurn && !!streaming && inTree.has(streaming.message_id);
  useEffect(() => {
    if (settled) settleTurn();
  }, [settled, settleTurn]);
  const overlay = myTurn && !settled ? myTurn : null;
  const busy =
    !!turn &&
    !turn.error &&
    turn.connection !== 'lost' &&
    (!streaming || streaming.status === 'streaming' || streaming.status === 'verifying');

  // 新消息接在分支最后一条后面；刚结束、树还没刷新时用流式回答的 id；还没有消息时接在 fork 消息后
  let parentId: ID | undefined = path.length ? path[path.length - 1].id : branch?.fork_message_id;
  if (
    overlay &&
    streaming &&
    (streaming.status === 'saved' || streaming.status === 'cancelled') &&
    !inTree.has(streaming.message_id)
  )
    parentId = streaming.message_id;
  const leafId = path.length ? path[path.length - 1].id : (branch?.fork_message_id ?? null);

  // 新内容到来时滚到底部
  const contentKey = `${path.length}:${overlay?.client_msg_id ?? ''}:${streaming?.text.length ?? 0}:${streaming?.status ?? ''}`;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && path.length + (overlay ? 1 : 0) > 0) el.scrollTop = el.scrollHeight;
  }, [contentKey, path.length, overlay]);

  if (!cid || tree.isLoading) {
    return (
      <section data-testid="right.branch-panel" data-state="loading" className="flex h-full flex-col p-5">
        <div className="mn-skel h-16 w-full rounded-card" />
      </section>
    );
  }
  if (!branch || !tree.data) {
    return (
      <section
        data-testid="right.branch-panel"
        data-state="not-found"
        className="flex h-full items-center justify-center text-[13px] text-faint"
      >
        分支不存在或已删除
      </section>
    );
  }

  const readOnly = branch.status !== 'open';
  const hasRound = path.some((m) => m.role === 'assistant');
  const empty = path.length === 0 && !overlay;
  const showOptimisticUser =
    overlay?.kind === 'send' && !(overlay.user_message_id && inTree.has(overlay.user_message_id));
  const liveView: AssistantView | null =
    overlay && streaming
      ? {
          id: streaming.message_id,
          content: streaming.text,
          steps: streaming.steps,
          citations: streaming.citations,
          status: streaming.status,
          ...(streaming.latency_ms !== undefined ? { latencyMs: streaming.latency_ms } : {}),
          ...(overlay.user_message_id ? { parentId: overlay.user_message_id } : {}),
        }
      : null;

  return (
    <LeafContext.Provider value={leafId}>
      <section
        data-testid="right.branch-panel"
        data-state={branch.status}
        data-bid={branch.id}
        aria-label={`分支：${branch.title}`}
        className="flex h-full min-h-0 flex-col bg-surface"
      >
        <div ref={scroller} data-testid="right.branch-panel.messages" className="min-h-0 flex-1 overflow-y-auto px-5">
          <div className="flex flex-col gap-5 pb-5 pt-4">
            <AnchorQuote branch={branch} ordinal={forkOrdinal(tree.data, branch)} />
            {branch.status === 'merged' && (
              <div
                data-testid="right.branch-panel.merged"
                role="status"
                className="-mt-2 rounded-btn bg-panel px-3 py-1.5 text-[12.5px] text-muted"
              >
                已合并到主线
              </div>
            )}
            {branch.status === 'archived' && (
              <div
                data-testid="right.branch-panel.archived"
                role="status"
                className="-mt-2 rounded-btn bg-panel px-3 py-1.5 text-[12.5px] text-muted"
              >
                已归档，只读
              </div>
            )}
            {path.map((m) => {
              if (m.role === 'user')
                return <UserMessage key={m.id} id={m.id} content={m.content} docTitles={docTitles} />;
              if (m.role !== 'assistant') return null;
              const isStreamed = streaming?.message_id === m.id;
              const latencyMs =
                isStreamed && streaming.latency_ms !== undefined
                  ? streaming.latency_ms
                  : historyLatencyMs(m, byId, [m.id]);
              const view: AssistantView = {
                id: m.id,
                content: m.content,
                steps: m.steps ?? [],
                citations: m.citations ?? [],
                status: isStreamed && streaming.status === 'cancelled' ? 'cancelled' : 'saved',
                ...(m.parent_id ? { parentId: m.parent_id } : {}),
                ...(latencyMs !== undefined ? { latencyMs } : {}),
              };
              return (
                <AssistantMessage
                  key={m.id}
                  view={view}
                  conversationId={cid}
                  siblings={[]}
                  busy={busy}
                  variant="branch"
                />
              );
            })}
            {showOptimisticUser && overlay && (
              <UserMessage
                id={overlay.user_message_id ?? `pending:${overlay.client_msg_id}`}
                content={overlay.content}
                docTitles={docTitles}
                pending={!overlay.user_message_id}
              />
            )}
            {overlay && liveView && (
              <AssistantMessage
                view={liveView}
                conversationId={cid}
                siblings={[]}
                busy={busy}
                connection={overlay.connection}
                errorText={overlay.error?.message}
                variant="branch"
              />
            )}
            {overlay && !streaming && overlay.error && (
              <div
                data-testid="right.branch-panel.error"
                role="alert"
                className="rounded-btn border border-line bg-surface px-3 py-2 text-[12.8px] text-danger"
              >
                {overlay.error.message}
              </div>
            )}
            {overlay && !streaming && !overlay.error && (
              <div data-testid="right.branch-panel.thinking" className="flex gap-1.5 py-2" aria-label="正在生成">
                <span className="mn-skel h-2.5 w-2.5 rounded-pill" />
                <span className="mn-skel h-2.5 w-2.5 rounded-pill [animation-delay:0.2s]" />
                <span className="mn-skel h-2.5 w-2.5 rounded-pill [animation-delay:0.4s]" />
              </div>
            )}
          </div>
        </div>
        <div className="flex-none border-t border-line px-4 pb-3.5 pt-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <ContextHint turns={branch.context_turns} />
            {branch.status === 'open' && hasRound && <MergeButton branch={branch} />}
          </div>
          <Composer
            key={branch.id}
            variant="branch"
            branchId={branch.id}
            conversationId={cid}
            parentId={parentId}
            autoFocus={empty && !readOnly}
            readOnly={readOnly}
            {...(empty ? { placeholder: NEW_BRANCH_PLACEHOLDER } : {})}
          />
        </div>
      </section>
    </LeafContext.Provider>
  );
}
