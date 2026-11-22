// 规格：docs/ux/state.md「useChat」。applyEvent 是 SSE 客户端唯一的写入口。
import { create } from 'zustand';
import { api } from '../api/client';
import type { OkResult } from '../api/endpoints';
import { sendMessageStream } from '../api/sse';
import type { Citation, Evidence, ID, Scope, SendMessageBody, SseEvent, Step } from '../api/types';

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

/** send 的目标：往哪个对话、接在哪条消息后、属于哪个分支 */
export interface SendTarget {
  conversation_id: ID;
  parent_id?: ID;
  branch_id?: ID;
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

export const useChat = create<ChatState>()((set, get) => ({
  projectId: null,
  conversationId: null,
  activeBranchId: null,
  setProject: (id) => set({ projectId: id }),
  setConversation: (id) => set({ conversationId: id, activeBranchId: null }),
  setActiveBranch: (id) => set({ activeBranchId: id }),
  streaming: null,
  composer: { [MAIN]: emptyDraft() },

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
    // F3 实现 SSE 客户端；F0 的 sse.ts 是空壳，调用会抛错
    sendMessageStream(target.conversation_id, body, { onEvent: (e) => get().applyEvent(e) });
  },

  cancel: async () => {
    const s = get().streaming;
    if (!s || (s.status !== 'streaming' && s.status !== 'verifying')) return;
    await api.post<OkResult>(`/api/messages/${encodeURIComponent(s.message_id)}/cancel`);
  },

  applyEvent: (e) =>
    set((state) => {
      if (e.event === 'message.start') {
        return {
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
          break;
        case 'error':
          next.status = 'error';
          break;
      }
      return { streaming: next };
    }),
}));
