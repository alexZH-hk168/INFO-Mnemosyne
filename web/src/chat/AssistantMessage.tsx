// 规格：1-消息列表-助手回答（chat.assistant-message）
// 无气泡的正文块：顶部步骤行，正文（Markdown＋公式＋证据胶囊），底部来源列表与操作。
// 状态：streaming 正文逐字出现、胶囊虚线待确认；verifying 步骤行末尾“核对引用…”；saved 胶囊按 verdict 显示；
// cancelled 末尾灰字“已停止生成”；error 红色提示条＋“重新生成”。流式连接：重连中灰字提示，重连失败保留内容并给“重新生成”。
// F5 追加：`branches` 有本条回答的分支时画分支标记（1-助手回答-分支标记）；`variant="branch"`（分支面板里）不显示来源列表、
// 操作行与“重新生成”（与 UI-05 右栏一致；分支里的重新生成/切换兄弟回答 v1 不做）。在分支里读证据时带 leaf_id（U44）。
import { useQueries } from '@tanstack/react-query';
import { memo, useMemo } from 'react';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import type { Branch, Citation, Evidence, ID, Step } from '../api/types';
import { useLeafId } from '../branch/leafContext';
import { markGroupsFor } from '../lib/branchMarkup';
import { AlertIcon } from '../icons/ChatIcons';
import { useChat, type Connection, type StreamStatus } from '../store/chat';
import AnswerBody from './AnswerBody';
import MessageActions from './MessageActions';
import SourceList from './SourceList';
import StepTrail from './StepTrail';

export interface AssistantView {
  id: ID;
  parentId?: ID;
  content: string;
  steps: Step[];
  citations: Citation[];
  status: StreamStatus;
  /** 整轮耗时（毫秒，U35），来源见 lib/latency.ts */
  latencyMs?: number;
}

interface Props {
  view: AssistantView;
  conversationId: ID;
  siblings: ID[];
  /** 有回合在生成中（禁用重新生成与切换） */
  busy: boolean;
  /** 仅流式中的这一条：连接状态与错误 */
  connection?: Connection;
  errorText?: string;
  /** F5 追加：对话树里的分支（主线回答据此画分支标记） */
  branches?: Branch[];
  /** F5 追加：main（默认，对话栏）/ branch（分支面板） */
  variant?: 'main' | 'branch';
}

const EMPTY_EV: Evidence[] = [];

/** 证据：流式中/刚结束的用本地池，历史消息按引用逐条读 ['evidence', eid]（与胶囊共用缓存） */
function useAnswerEvidence(messageId: ID, citations: Citation[]): { evidence: Evidence[]; complete: boolean } {
  const local = useChat((s) => (s.streaming?.message_id === messageId ? s.streaming.evidence : null));
  const leafId = useLeafId();
  const eids = useMemo(() => [...new Set(citations.map((c) => c.eid))], [citations]);
  const results = useQueries({
    queries: (local ? [] : eids).map((eid) => ({
      queryKey: queryKeys.evidenceAt(eid, leafId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<Evidence>(`/api/evidence/${encodeURIComponent(eid)}`, {
          signal,
          ...(leafId ? { query: { leaf_id: leafId } } : {}),
        }),
    })),
  });
  if (local) return { evidence: local, complete: true };
  const loaded = results.flatMap((r, i) =>
    r.data ? [{ ...r.data, label: r.data.label ?? citations.find((c) => c.eid === eids[i])?.label }] : [],
  );
  // 历史消息只读得到被引用的证据（U110：步骤行不能据此断定“没有找到”）
  return { evidence: loaded.length ? loaded : EMPTY_EV, complete: false };
}

function AssistantMessage({
  view,
  conversationId,
  siblings,
  busy,
  connection,
  errorText,
  branches,
  variant = 'main',
}: Props) {
  const { evidence, complete: evidenceComplete } = useAnswerEvidence(view.id, view.citations);
  const final0 = view.status === 'saved' || view.status === 'cancelled';
  const marks = useMemo(
    () => (branches && final0 ? markGroupsFor(view.id, view.content, branches) : undefined),
    [branches, final0, view.id, view.content],
  );
  const inBranch = variant === 'branch';
  const live = view.status === 'streaming' || view.status === 'verifying';
  const final = view.status === 'saved' || view.status === 'cancelled';
  const lost = connection === 'lost';

  return (
    <div data-testid={`chat.assistant-message:${view.id}`} data-status={view.status} className="group">
      <StepTrail
        messageId={view.id}
        steps={view.steps}
        evidence={evidence}
        evidenceComplete={evidenceComplete}
        verifying={view.status === 'verifying'}
        latencyMs={view.latencyMs}
      />
      {view.content ? (
        <AnswerBody
          messageId={view.id}
          content={view.content}
          citations={view.citations}
          streaming={view.status === 'streaming' && !lost}
          marks={marks}
        />
      ) : (
        live && (
          <div
            data-testid={`chat.assistant-message.thinking:${view.id}`}
            className="flex gap-1.5 py-2"
            aria-label="正在生成"
          >
            <span className="mn-skel h-2.5 w-2.5 rounded-pill" />
            <span className="mn-skel h-2.5 w-2.5 rounded-pill [animation-delay:0.2s]" />
            <span className="mn-skel h-2.5 w-2.5 rounded-pill [animation-delay:0.4s]" />
          </div>
        )
      )}
      {view.status === 'cancelled' && (
        <div data-testid={`chat.assistant-message.cancelled:${view.id}`} className="mt-1.5 text-[12.5px] text-faint">
          已停止生成
        </div>
      )}
      {connection === 'reconnecting' && live && (
        <div data-testid="chat.stream-client.reconnecting" className="mt-1.5 text-[12.5px] text-muted">
          连接中断，正在重连…
        </div>
      )}
      {(view.status === 'error' || (lost && !final)) && (
        <div
          data-testid={`chat.assistant-message.error:${view.id}`}
          role="alert"
          className="mt-2 flex items-center gap-2 rounded-btn border border-line bg-surface px-3 py-2 text-[12.8px] text-danger"
        >
          <AlertIcon size={15} />
          <span className="min-w-0 flex-1">{lost ? '连接中断，已保留生成到的内容' : (errorText ?? '生成失败')}</span>
          {!inBranch && (
            <button
              type="button"
              data-testid={`chat.assistant-message.retry:${view.id}`}
              disabled={busy}
              onClick={() => {
                const t: { conversation_id: ID; parent_id?: ID } = { conversation_id: conversationId };
                if (view.parentId) t.parent_id = view.parentId;
                useChat.getState().regenerate(view.id, t);
              }}
              className="mn-focus flex-none rounded-btn-sm px-2 py-0.5 text-ink-2 hover:bg-sel hover:text-ink"
            >
              重新生成
            </button>
          )}
        </div>
      )}
      {final && !inBranch && <SourceList messageId={view.id} citations={view.citations} />}
      {final && !inBranch && (
        <MessageActions
          conversationId={conversationId}
          messageId={view.id}
          parentId={view.parentId}
          content={view.content}
          siblings={siblings}
          busy={busy}
          canCopy={view.content.length > 0}
        />
      )}
    </div>
  );
}

export default memo(AssistantMessage);
