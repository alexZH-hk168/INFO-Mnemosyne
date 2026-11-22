// 规格：docs/ux/state.md「useChat」。applyEvent 是 SSE 客户端唯一的写入口。
// F3 追加（只追加，不改已有名字）：setDraft、turn、regenerate、SendTarget.model_tier；send 接上真实的 SSE 客户端。
import { create } from 'zustand';
import { api } from '../api/client';
import type { OkResult } from '../api/endpoints';
import { regenerateMessageStream, sendMessageStream, type StreamHandle, type StreamHandlers } from '../api/sse';
import type { Citation, ErrorCode, Evidence, ID, Scope, SendMessageBody, SseEvent, Step } from '../api/types';

type EvidenceEventData = Extract<SseEvent, { event: 'evidence' }>['data'];

/** SSE `evidence` 事件 → `Evidence`：`eid` 即 `Evidence.id`，其余同名字段照拷（契约 v0.2） */
export function evidenceFromEvent(d: EvidenceEventData): Evidence {
  const ev: Evidence = {
    id: d.eid,
    label: d.label,
    source_type: d.source_type,
    source_id: d.source_id,
    title: d.title,
    locator: d.locator,
    quote: d.quote,
  };
  if (d.sha256 !== undefined) ev.sha256 = d.sha256;
  return ev;
}

export type StreamStatus = 'streaming' | 'verifying' | 'saved' | 'cancelled' | 'error';

export interface Streaming {
  message_id: ID;
  client_msg_id: string;
  last_seq: number;
  steps: Step[];
  evidence: Evidence[];
  text: string;
  citations: Citation[];
  status: StreamStatus;
}

export interface ComposerDraft {
  text: string;
  web_search: boolean;
  scope: Scope;
  forced_skill?: string;
  attachments: ID[];
}

/** 草稿按 `branchId ?? 'main'` 存 */
export type ComposerKey = string;
export const MAIN: ComposerKey = 'main';

/** F3 追加：模型档位（规格 1-输入框-模型档位），随发送写入请求头 `X-Model-Tier` */
export type ModelTier = 'high' | 'fast';

/** send 的目标：往哪个对话、接在哪条消息后、属于哪个分支 */
export interface SendTarget {
  conversation_id: ID;
  parent_id?: ID;
  branch_id?: ID;
  /** F3 追加：模型档位，缺省为 high（不发请求头） */
  model_tier?: ModelTier;
}

/** F3 追加：SSE 连接状态（规格 1-对话栏-流式连接「状态」） */
export type Connection = 'live' | 'reconnecting' | 'lost';

/**
 * F3 追加：进行中/刚结束的这一轮。
 * 发送后立即建立（乐观插入用户消息），收到 message.start 补上 user_message_id；
 * 树（['tree', cid]）里出现对应消息后由对话栏清掉乐观显示。
 */
export interface Turn {
  kind: 'send' | 'regenerate';
  conversation_id: ID;
  client_msg_id: string;
  /** 用户原文；重新生成时为空串 */
  content: string;
  parent_id?: ID;
  branch_id?: ID;
  /** 被重新生成的回答 id */
  regenerate_of?: ID;
  /** message.start 之后的用户消息 id */
  user_message_id?: ID;
  connection: Connection;
  /** SSE `error` 事件或请求失败 */
  error?: { code: ErrorCode; message: string; retriable: boolean };
  /** message.end 的 latency_ms */
  latency_ms?: number;
}

export interface ChatState {
  projectId: ID | null;
  conversationId: ID | null;
  /** null 表示主线 */
  activeBranchId: ID | null;
  setProject: (id: ID) => void;
  /** 同时把 activeBranchId 置回 null（回到主线） */
  setConversation: (id: ID | null) => void;
  setActiveBranch: (id: ID | null) => void;
  streaming: Streaming | null;
  composer: Record<ComposerKey, ComposerDraft>;
  send: (target: SendTarget) => void;
  cancel: () => Promise<void>;
  applyEvent: (e: SseEvent) => void;
  /** F3 追加（编排决定 U25）：合并修改某份草稿；不存在时以空草稿为底 */
  setDraft: (key: ComposerKey, patch: Partial<ComposerDraft>) => void;
  /** F3 追加：当前这一轮 */
  turn: Turn | null;
  /** F3 追加：POST /api/messages/{mid}/regenerate，新回答是原回答的兄弟 */
  regenerate: (messageId: ID, target: { conversation_id: ID; parent_id?: ID; model_tier?: ModelTier }) => void;
  /** F3 追加：对话栏确认树里已有本轮消息后调用，去掉乐观显示（streaming 保留，供证据定位） */
  settleTurn: () => void;
}

export const emptyDraft = (): ComposerDraft => ({
  text: '',
  web_search: false,
  scope: { mode: 'all' },
  attachments: [],
});

function newClientMsgId(): string {
  return globalThis.crypto.randomUUID();
}

/** 当前连接（同一时间只有一条） */
let handle: StreamHandle | null = null;

const tierHeaders = (tier?: ModelTier) => (tier ? { 'X-Model-Tier': tier } : undefined);

export const useChat = create<ChatState>()((set, get) => {
  const patchTurn = (patch: Partial<Turn>) => set((s) => (s.turn ? { turn: { ...s.turn, ...patch } } : {}));

  const handlers = (): StreamHandlers => ({
    onEvent: (e) => get().applyEvent(e),
    onReconnecting: () => patchTurn({ connection: 'reconnecting' }),
    onReconnected: () => patchTurn({ connection: 'live' }),
    onGiveUp: () => patchTurn({ connection: 'lost' }),
    onFail: (err) => patchTurn({ error: { code: err.code, message: err.message, retriable: err.retriable } }),
  });

  return {
    projectId: null,
    conversationId: null,
    activeBranchId: null,
    setProject: (id) => set({ projectId: id }),
    setConversation: (id) => set({ conversationId: id, activeBranchId: null }),
    setActiveBranch: (id) => set({ activeBranchId: id }),
    streaming: null,
    composer: { [MAIN]: emptyDraft() },
    turn: null,

    setDraft: (key, patch) =>
      set((s) => ({ composer: { ...s.composer, [key]: { ...(s.composer[key] ?? emptyDraft()), ...patch } } })),

    send: (target) => {
      const key = target.branch_id ?? MAIN;
      const draft = get().composer[key] ?? emptyDraft();
      const body: SendMessageBody = {
        client_msg_id: newClientMsgId(),
        content: draft.text,
        web_search: draft.web_search,
        scope: draft.scope,
      };
      if (target.parent_id) body.parent_id = target.parent_id;
      if (target.branch_id) body.branch_id = target.branch_id;
      if (draft.forced_skill) body.forced_skill = draft.forced_skill;

      handle?.close();
      const turn: Turn = {
        kind: 'send',
        conversation_id: target.conversation_id,
        client_msg_id: body.client_msg_id,
        content: body.content,
        connection: 'live',
      };
      if (body.parent_id) turn.parent_id = body.parent_id;
      if (body.branch_id) turn.branch_id = body.branch_id;
      set({ turn, streaming: null });
      // 发送后清空当前草稿：文字、强制 Skill、附件；@ 引用随文字一起清掉，范围回到“全部材料”；联网开关与“不用材料”保留
      get().setDraft(key, {
        text: '',
        forced_skill: undefined,
        attachments: [],
        scope: draft.scope.mode === 'selected' ? { mode: 'all' } : draft.scope,
      });
      handle = sendMessageStream(target.conversation_id, body, handlers(), {
        headers: tierHeaders(target.model_tier),
      });
    },

    regenerate: (messageId, target) => {
      handle?.close();
      const turn: Turn = {
        kind: 'regenerate',
        conversation_id: target.conversation_id,
        client_msg_id: '',
        content: '',
        regenerate_of: messageId,
        connection: 'live',
      };
      if (target.parent_id) turn.parent_id = target.parent_id;
      set({ turn, streaming: null });
      handle = regenerateMessageStream(messageId, handlers(), { headers: tierHeaders(target.model_tier) });
    },

    settleTurn: () => set({ turn: null }),

    cancel: async () => {
      const s = get().streaming;
      if (!s || (s.status !== 'streaming' && s.status !== 'verifying')) return;
      await api.post<OkResult>(`/api/messages/${encodeURIComponent(s.message_id)}/cancel`);
    },

    applyEvent: (e) =>
      set((state) => {
        if (e.event === 'message.start') {
          const turn = state.turn
            ? {
                ...state.turn,
                user_message_id: e.data.user_message_id,
                client_msg_id: state.turn.client_msg_id || e.data.client_msg_id,
              }
            : state.turn;
          return {
            turn,
            streaming: {
              message_id: e.data.message_id,
              client_msg_id: e.data.client_msg_id,
              last_seq: e.data.seq,
              steps: [],
              evidence: [],
              text: '',
              citations: [],
              status: 'streaming',
            },
          };
        }
        const s = state.streaming;
        // 没有进行中的回答，或重复/过期的事件（续流时可能补发）：忽略
        if (!s || e.data.seq <= s.last_seq) return {};
        const next: Streaming = { ...s, last_seq: e.data.seq };
        let turn = state.turn;
        switch (e.event) {
          case 'step': {
            const { seq: _seq, ...step } = e.data;
            const i = next.steps.findIndex((x) => x.step_id === step.step_id);
            next.steps = i < 0 ? [...next.steps, step] : next.steps.map((x, j) => (j === i ? step : x));
            break;
          }
          case 'evidence': {
            const ev = evidenceFromEvent(e.data);
            if (!next.evidence.some((x) => x.id === ev.id)) next.evidence = [...next.evidence, ev];
            break;
          }
          case 'delta':
            next.text = next.text + e.data.text;
            break;
          case 'citation': {
            const { seq: _seq, ...c } = e.data;
            next.citations = [...next.citations, c];
            next.status = 'verifying';
            break;
          }
          case 'message.end':
            next.status = e.data.cancelled ? 'cancelled' : 'saved';
            if (turn) turn = { ...turn, latency_ms: e.data.latency_ms, connection: 'live' };
            break;
          case 'error':
            next.status = 'error';
            if (turn)
              turn = { ...turn, error: { code: e.data.code, message: e.data.message, retriable: e.data.retriable } };
            break;
        }
        return { streaming: next, turn };
      }),
  };
});
