// SSE 客户端：F3 里程碑实现（规格见 docs/contract/sse-events.md 与 F3 的 UX 规格）。
// F0 只固定对外签名，调用会直接抛错，防止被误当成已实现。
import type { ID, SendMessageBody, SseEvent } from './types';

export interface StreamHandlers {
  /** 每收到一个事件调用一次；useChat.applyEvent 是唯一写入口 */
  onEvent: (e: SseEvent) => void;
  /** 三次重连都失败（sse-events.md「断线续流」第 3 条） */
  onGiveUp?: (lastSeq: number) => void;
}

export interface StreamHandle {
  /** 主动断开本地连接（不等于取消生成，取消走 POST /cancel） */
  close: () => void;
}

/** POST /api/conversations/{cid}/messages */
export function sendMessageStream(_cid: ID, _body: SendMessageBody, _handlers: StreamHandlers): StreamHandle {
  throw new Error('sendMessageStream 尚未实现（F3）');
}

/** GET /api/messages/{mid}/events?after_seq=N */
export function resumeMessageStream(_mid: ID, _afterSeq: number, _handlers: StreamHandlers): StreamHandle {
  throw new Error('resumeMessageStream 尚未实现（F3）');
}

/** POST /api/messages/{mid}/regenerate */
export function regenerateMessageStream(_mid: ID, _handlers: StreamHandlers): StreamHandle {
  throw new Error('regenerateMessageStream 尚未实现（F3）');
}
