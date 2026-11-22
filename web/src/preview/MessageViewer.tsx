// 规格：2-证据胶囊-历史对话预览（right.message-preview）
// 灰色胶囊（历史对话）打开后只读显示那段原始对话，高亮被引用的字符区间；顶部“来自对话：<标题> · 日期”，可“打开该对话”。
// 入口：证据胶囊（历史对话）/ 设置·记忆的“查看来源”，tab kind=message，ref_id=message_id。接口：['evidence', eid] 的 context_messages。
// 从“查看来源”打开时没有证据 id：退回当前对话树里的这条消息及其前后各 1 条（不新增接口）。界面不出现“记忆”字样。
import { useEffect, useRef } from 'react';
import { ApiRequestError } from '../api/client';
import { useEvidence as useEvidenceQuery, useTree } from '../api/queries';
import type { ID, Message } from '../api/types';
import { BubbleIcon } from '../icons/ChatIcons';
import { stripCitations } from '../lib/citations';
import { goConversation } from '../lib/nav';
import { useChat } from '../store/chat';
import type { Tab } from '../store/layout';
import { useEvidence } from '../store/evidence';
import HighlightedText from './HighlightedText';
import { useTabEvidence } from './useEvidenceContext';

function day(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 当前对话树里这条消息与前后各 1 条（没有证据 id 时的退路） */
export function neighbors(messages: Message[], mid: ID): Message[] {
  const m = messages.find((x) => x.id === mid);
  if (!m) return [];
  const parent = m.parent_id ? messages.find((x) => x.id === m.parent_id) : undefined;
  const child = messages
    .filter((x) => x.parent_id === m.id && (x.branch_id ?? null) === (m.branch_id ?? null))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return [parent, m, child].filter((x): x is Message => !!x);
}

/** 打开对话后把消息滚入视野（对话栏渲染是异步的，最多等 2 秒） */
function scrollToMessage(mid: ID) {
  const until = Date.now() + 2000;
  const tick = () => {
    const el = document.querySelector<HTMLElement>(
      `[data-testid="chat.assistant-message:${mid}"], [data-testid="chat.user-message:${mid}"]`,
    );
    if (el) el.scrollIntoView({ block: 'center' });
    else if (Date.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export default function MessageViewer({ tab }: { tab: Tab }) {
  const mid = tab.ref_id;
  const selected = useTabEvidence(tab);
  // 流式证据池里没有 context_messages：一律按 id 再读一次 REST
  const full = useEvidenceQuery(selected?.id ?? null);
  const conversationId = useChat((s) => s.conversationId);
  const tree = useTree(selected ? null : conversationId);
  const nonce = useEvidence((s) => s.messageEvidence);
  const markRef = useRef<HTMLElement>(null);

  const ev = full.data ?? selected;
  const fromEvidence = ev?.context_messages;
  const messages = fromEvidence ?? (tree.data ? neighbors(tree.data.messages, mid) : []);
  const cited = messages.find((m) => m.id === mid);
  const loc = (ev?.locator ?? {}) as { char_range?: unknown };
  const range =
    Array.isArray(loc.char_range) && loc.char_range.length === 2 ? (loc.char_range as [number, number]) : null;
  const title = ev?.title ?? (fromEvidence ? undefined : tree.data?.conversation.title) ?? tab.title;
  const targetCid = cited?.conversation_id ?? messages[0]?.conversation_id;

  useEffect(() => {
    if (range) markRef.current?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cited?.id, range?.[0], range?.[1], nonce]);

  const err = full.error instanceof ApiRequestError ? full.error : null;
  const loading = selected ? full.isLoading && !fromEvidence : tree.isLoading;

  return (
    <div data-testid="right.message-preview" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
        <BubbleIcon size={15} className="text-evi-msg-ink" />
        <div data-testid="right.message-preview.source" className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
          来自对话：<span className="font-medium text-ink">{title}</span>
          {cited && <span className="text-muted"> · {day(cited.created_at)}</span>}
        </div>
        {targetCid && (
          <button
            type="button"
            data-testid="right.message-preview.open"
            onClick={() => {
              goConversation(targetCid);
              scrollToMessage(mid);
            }}
            className="mn-focus flex-none rounded-btn border border-line px-2 py-1 text-[12px] text-ink-2 hover:bg-panel"
          >
            打开该对话
          </button>
        )}
      </header>
      <div tabIndex={0} aria-label="历史对话原文" className="mn-focus min-h-0 flex-1 overflow-auto px-4 py-3">
        {err?.code === 'NOT_VISIBLE_ON_PATH' ? (
          <div
            data-testid="right.message-preview.error"
            role="alert"
            className="py-8 text-center text-[13px] text-muted"
          >
            这段对话在其他分支中，当前不可见
          </div>
        ) : loading ? (
          <div data-testid="right.message-preview.loading" aria-busy="true" className="flex flex-col gap-2">
            {[60, 85, 50].map((w, i) => (
              <div key={i} className="mn-skel h-3.5" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div data-testid="right.message-preview.empty" className="py-8 text-center text-[13px] text-muted">
            {full.error ? `读取失败：${(full.error as Error).message}` : '读不到这段对话的原文'}
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => {
              const isCited = m.id === mid;
              return (
                <li
                  key={m.id}
                  data-testid={`right.message-preview.message:${m.id}`}
                  data-cited={isCited || undefined}
                  className={`rounded-card-sm px-3 py-2 text-[13px] leading-[1.75] ${
                    m.role === 'user' ? 'bg-panel text-ink' : 'border border-line text-ink-2'
                  } ${isCited ? '' : 'opacity-80'}`}
                >
                  <div className="mb-0.5 text-[11px] text-muted">{m.role === 'user' ? '提问' : '回答'}</div>
                  <HighlightedText
                    ref={isCited ? markRef : undefined}
                    text={stripCitations(m.content)}
                    range={isCited ? range : null}
                    markTestid="right.message-preview.highlight"
                    paragraphClass="my-0.5"
                  />
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
