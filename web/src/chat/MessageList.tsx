// 规格：1-对话栏-消息列表（chat.message-list）
// 按主线路径（根 → active_leaf，沿 parent 链）顺序渲染用户消息、助手回答；正在进行的一轮（useChat.turn / streaming）叠在末尾：
// 发送后立即插入用户消息（乐观，透明 0.7），回答流式出现；树里出现这一轮后由树渲染（settleTurn）。
// 重新生成时从被替换的回答处截断，后面接新回答。新内容到来时若用户在底部则自动滚动；上滚时不抢滚动，底部出现“↓ 新内容”。
// 消息块最大宽度 720 px 居中。合并卡片（role=merge_note）与划词工具条属 F5：merge_note 先按普通文字占位。
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConversationTree, ID, Message } from '../api/types';
import { ArrowDownIcon } from '../icons/ChatIcons';
import { historyLatencyMs } from '../lib/latency';
import { useChat } from '../store/chat';
import AssistantMessage, { type AssistantView } from './AssistantMessage';
import UserMessage from './UserMessage';

/** 主线路径：从叶子沿 parent_id 回到根 */
export function mainPath(tree: ConversationTree): Message[] {
  const byId = new Map(tree.messages.map((m) => [m.id, m]));
  const leaf = tree.active_leaf_id ?? tree.conversation.active_leaf_id;
  const out: Message[] = [];
  let cur = leaf ? byId.get(leaf) : undefined;
  const guard = new Set<ID>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    out.push(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out.reverse();
}

/** 兄弟回答：同一 parent_id、同一分支的 assistant，按创建时间 */
export function siblingsOf(tree: ConversationTree, m: Pick<Message, 'id' | 'parent_id' | 'branch_id'>): ID[] {
  return tree.messages
    .filter(
      (x) => x.role === 'assistant' && x.parent_id === m.parent_id && (x.branch_id ?? null) === (m.branch_id ?? null),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((x) => x.id);
}

const BOTTOM_SLACK = 48;

interface Props {
  conversationId: ID;
  tree: ConversationTree;
  docTitles: string[];
}

function MessageList({ conversationId, tree, docTitles }: Props) {
  const turn = useChat((s) => s.turn);
  const streaming = useChat((s) => s.streaming);
  const settleTurn = useChat((s) => s.settleTurn);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [newContent, setNewContent] = useState(false);

  const path = useMemo(() => mainPath(tree), [tree]);
  const inTree = useMemo(() => new Set(tree.messages.map((m) => m.id)), [tree]);
  const byId = useMemo(() => new Map(tree.messages.map((m) => [m.id, m])), [tree]);

  // 本对话主线上的进行中一轮（分支里的回合由 F5 的分支面板显示）
  const myTurn = turn && turn.conversation_id === conversationId && !turn.branch_id ? turn : null;
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

  // 重新生成：截到被替换回答之前
  let shown = path;
  if (overlay?.kind === 'regenerate' && overlay.regenerate_of) {
    const i = path.findIndex((m) => m.id === overlay.regenerate_of);
    if (i >= 0) shown = path.slice(0, i);
  }
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
          ...(overlay.kind === 'regenerate'
            ? overlay.parent_id
              ? { parentId: overlay.parent_id }
              : {}
            : overlay.user_message_id
              ? { parentId: overlay.user_message_id }
              : {}),
        }
      : null;

  // ---------------------------------------------------------------- 滚动
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    if (atBottom.current) setNewContent(false);
  };
  const toBottom = (smooth = false) => {
    const el = scroller.current;
    if (el) {
      if (smooth && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      else el.scrollTop = el.scrollHeight;
    }
    atBottom.current = true;
    setNewContent(false);
  };
  // 打开对话时到底部
  useLayoutEffect(() => {
    toBottom();
  }, [conversationId]);
  // 新内容：在底部就跟随，否则提示
  const contentKey = `${shown.length}:${showOptimisticUser}:${streaming?.text.length ?? 0}:${streaming?.steps.length ?? 0}:${streaming?.status ?? ''}`;
  useLayoutEffect(() => {
    if (atBottom.current) toBottom();
    else setNewContent(true);
  }, [contentKey]);
  // 发出新消息时总是回到底部
  useLayoutEffect(() => {
    if (myTurn) toBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn?.client_msg_id, myTurn?.regenerate_of]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} data-testid="chat.message-list" onScroll={onScroll} className="h-full overflow-y-auto px-6">
        <div className="mx-auto flex max-w-[720px] flex-col gap-5 pb-6 pt-4">
          {shown.map((m) => {
            if (m.role === 'user')
              return <UserMessage key={m.id} id={m.id} content={m.content} docTitles={docTitles} />;
            if (m.role === 'assistant') {
              const isStreamed = streaming?.message_id === m.id;
              const siblings = siblingsOf(tree, m);
              const latencyMs =
                isStreamed && streaming.latency_ms !== undefined
                  ? streaming.latency_ms
                  : historyLatencyMs(m, byId, siblings);
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
                  conversationId={conversationId}
                  siblings={siblings}
                  busy={busy}
                />
              );
            }
            // merge_note（F5 合并卡片）/ tool：占位
            return (
              <div key={m.id} data-testid={`chat.message-list.other:${m.id}`} className="text-[12.5px] text-muted">
                {m.content}
              </div>
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
              conversationId={conversationId}
              siblings={[]}
              busy={busy}
              connection={overlay.connection}
              errorText={overlay.error?.message}
            />
          )}
          {overlay && !streaming && overlay.error && (
            <div
              data-testid="chat.assistant-message.error:pending"
              role="alert"
              className="rounded-btn border border-line bg-surface px-3 py-2 text-[12.8px] text-danger"
            >
              {overlay.error.message}
            </div>
          )}
          {overlay && !streaming && !overlay.error && (
            <div
              data-testid="chat.assistant-message.thinking:pending"
              className="flex gap-1.5 py-2"
              aria-label="正在生成"
            >
              <span className="mn-skel h-2.5 w-2.5 rounded-pill" />
              <span className="mn-skel h-2.5 w-2.5 rounded-pill [animation-delay:0.2s]" />
              <span className="mn-skel h-2.5 w-2.5 rounded-pill [animation-delay:0.4s]" />
            </div>
          )}
        </div>
      </div>
      {newContent && (
        <button
          type="button"
          data-testid="chat.message-list.new-content"
          onClick={() => toBottom(true)}
          className="mn-focus absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-pill border border-line bg-surface px-3 py-1 text-[12.5px] text-ink-2 shadow-[var(--shadow-pop)] hover:text-ink"
        >
          <ArrowDownIcon size={13} />
          新内容
        </button>
      )}
    </div>
  );
}

export default memo(MessageList);
