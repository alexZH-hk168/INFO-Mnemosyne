// 规格：1-对话栏-流式连接（chat.stream-client）；契约 docs/contract/sse-events.md。
// fetch + ReadableStream 解析事件流（POST 不能用 EventSource），按事件调用 onEvent（由 useChat.applyEvent 写入 store）。
// 断线续流：记录最后的 seq 与 message_id，按 1 s、2 s、4 s 重试 GET /api/messages/{mid}/events?after_seq=N；
// 还没收到 message.start 就断开时用同一个 client_msg_id 重新 POST（后端不会重复建消息）；三次都失败交给 onGiveUp。
// 忽略 `: ping` 注释行；超过 45 s 没有任何数据视为断开；收到 seq 不大于已处理 seq 的事件直接丢弃。
import { ApiRequestError, parseErrorResponse } from './client';
import type { ID, SendMessageBody, SseEvent } from './types';

export interface StreamHandlers {
  /** 每收到一个事件调用一次；useChat.applyEvent 是唯一写入口 */
  onEvent: (e: SseEvent) => void;
  /** 三次重连都失败（sse-events.md「断线续流」第 3 条） */
  onGiveUp?: (lastSeq: number) => void;
  /** F3 追加：连接中断、即将第 attempt 次重连（从 1 开始） */
  onReconnecting?: (attempt: number) => void;
  /** F3 追加：重连后又收到了数据 */
  onReconnected?: () => void;
  /** F3 追加：请求本身被拒（非 2xx 且不可重试，如 404），不会再重试 */
  onFail?: (err: ApiRequestError) => void;
}

export interface StreamHandle {
  /** 主动断开本地连接（不等于取消生成，取消走 POST /cancel） */
  close: () => void;
}

/** F3 追加：可选参数（测试里缩短等待） */
export interface StreamOptions {
  /** 额外请求头，如规格 1-输入框-模型档位的 `X-Model-Tier` */
  headers?: Record<string, string>;
  /** 重连间隔，默认 1 s、2 s、4 s */
  retryDelaysMs?: number[];
  /** 多久没有任何数据视为断开，默认 45 s */
  idleTimeoutMs?: number;
}

export const RETRY_DELAYS_MS = [1000, 2000, 4000];
export const IDLE_TIMEOUT_MS = 45_000;

const KNOWN_EVENTS = new Set<SseEvent['event']>([
  'message.start',
  'step',
  'evidence',
  'delta',
  'citation',
  'message.end',
  'error',
]);

/** 解析一个事件块（以空行分隔）；注释行、未知事件、坏 JSON 返回 null */
export function parseSseBlock(block: string): SseEvent | null {
  let event = '';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!event || data.length === 0 || !KNOWN_EVENTS.has(event as SseEvent['event'])) return null;
  try {
    const parsed = JSON.parse(data.join('\n')) as { seq?: unknown };
    if (typeof parsed?.seq !== 'number') return null;
    return { event, data: parsed } as SseEvent;
  } catch {
    return null;
  }
}

class Dropped extends Error {}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

type Opener = (signal: AbortSignal) => Promise<Response>;

/**
 * 通用驱动：first 打开首个连接；断开后有 message_id 走 resume，否则再调 first（同一 client_msg_id）。
 */
function drive(first: Opener, resume: (mid: ID, afterSeq: number) => Opener, h: StreamHandlers, opts: StreamOptions) {
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const idleMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const life = new AbortController();
  let lastSeq = 0;
  let messageId: ID | null = null;
  let ended = false;

  /** 读完一个连接；正常结束返回，掉线抛 Dropped */
  async function consume(res: Response, conn: AbortController, onData: () => void): Promise<void> {
    if (!res.ok) throw await parseErrorResponse(res);
    if (!res.body) throw new Dropped('没有响应体');
    const reader = res.body.getReader();
    // 断开时同时 cancel reader：不依赖 fetch 对 AbortSignal 的支持（测试环境里 signal 会被去掉）
    const cancelReader = () => void reader.cancel().catch(() => undefined);
    if (conn.signal.aborted) cancelReader();
    conn.signal.addEventListener('abort', cancelReader, { once: true });
    const decoder = new TextDecoder();
    let buffer = '';
    let idle: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => conn.abort(), idleMs);
    };
    arm();
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          throw new Dropped('读取中断');
        }
        if (chunk.done) break;
        if (conn.signal.aborted) throw new Dropped('已断开');
        arm();
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n?/g, '\n');
        let cut = buffer.indexOf('\n\n');
        while (cut >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const e = parseSseBlock(block);
          if (e && e.data.seq > lastSeq) {
            if (e.event === 'message.start') messageId = e.data.message_id;
            lastSeq = e.data.seq;
            onData();
            h.onEvent(e);
            if (e.event === 'message.end' || e.event === 'error') ended = true;
          }
          cut = buffer.indexOf('\n\n');
        }
        if (ended) {
          void reader.cancel().catch(() => undefined);
          return;
        }
      }
    } finally {
      clearTimeout(idle);
      conn.signal.removeEventListener('abort', cancelReader);
    }
    if (!ended) throw new Dropped('连接在 message.end 之前结束');
  }

  async function run() {
    let failures = 0;
    for (;;) {
      if (life.signal.aborted) return;
      const conn = new AbortController();
      const stop = () => conn.abort();
      life.signal.addEventListener('abort', stop, { once: true });
      try {
        const open = messageId ? resume(messageId, lastSeq) : first;
        const res = await open(conn.signal);
        await consume(res, conn, () => {
          if (failures > 0) {
            failures = 0;
            h.onReconnected?.();
          }
        });
        return;
      } catch (err) {
        if (life.signal.aborted) return;
        if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) {
          h.onFail?.(err);
          return;
        }
        if (failures >= delays.length) {
          h.onGiveUp?.(lastSeq);
          return;
        }
        failures += 1;
        h.onReconnecting?.(failures);
        await sleep(delays[failures - 1], life.signal);
      } finally {
        life.signal.removeEventListener('abort', stop);
      }
    }
  }

  void run();
  return { close: () => life.abort() };
}

const jsonHeaders = (extra?: Record<string, string>) => ({
  Accept: 'text/event-stream',
  'Content-Type': 'application/json',
  ...extra,
});

const resumeOpener =
  (opts: StreamOptions) =>
  (mid: ID, afterSeq: number): Opener =>
  (signal) =>
    fetch(`/api/messages/${encodeURIComponent(mid)}/events?after_seq=${afterSeq}`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', ...opts.headers },
      signal,
    });

/** POST /api/conversations/{cid}/messages */
export function sendMessageStream(
  cid: ID,
  body: SendMessageBody,
  handlers: StreamHandlers,
  opts: StreamOptions = {},
): StreamHandle {
  const first: Opener = (signal) =>
    fetch(`/api/conversations/${encodeURIComponent(cid)}/messages`, {
      method: 'POST',
      headers: jsonHeaders(opts.headers),
      body: JSON.stringify(body),
      signal,
    });
  return drive(first, resumeOpener(opts), handlers, opts);
}

/** GET /api/messages/{mid}/events?after_seq=N */
export function resumeMessageStream(
  mid: ID,
  afterSeq: number,
  handlers: StreamHandlers,
  opts: StreamOptions = {},
): StreamHandle {
  const opener = resumeOpener(opts);
  return drive(opener(mid, afterSeq), opener, handlers, opts);
}

/** POST /api/messages/{mid}/regenerate */
export function regenerateMessageStream(mid: ID, handlers: StreamHandlers, opts: StreamOptions = {}): StreamHandle {
  const first: Opener = (signal) =>
    fetch(`/api/messages/${encodeURIComponent(mid)}/regenerate`, {
      method: 'POST',
      headers: jsonHeaders(opts.headers),
      signal,
    });
  return drive(first, resumeOpener(opts), handlers, opts);
}
