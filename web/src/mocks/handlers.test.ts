// @vitest-environment node
// 验收：每个 REST 接口在 MSW 下 fetch 得到 fixture；事件流 fixture 能被逐条读到（间隔 80 ms）。
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '../api/endpoints';
import type { SseEvent } from '../api/types';
import type { RestFixture, SseFixture } from './fixture-types';
import { SSE_INTERVAL_MS, fixtures, resetMockScenarios, setMockScenario } from './handlers';
import { server } from './node';

const BASE = 'http://localhost';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => resetMockScenarios());
afterAll(() => server.close());

function urlFor(
  endpoint: string,
  fx: { request?: { params?: Record<string, string>; query?: Record<string, string> } },
): string {
  const path = endpoint
    .split(' ')[1]
    .replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(fx.request?.params?.[k] ?? 'x'));
  const qs = new URLSearchParams(fx.request?.query ?? {}).toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

function initFor(endpoint: string, fx: { request?: { body?: unknown; files?: string[] } }): RequestInit {
  const method = endpoint.split(' ')[0];
  if (fx.request?.files) {
    const form = new FormData();
    for (const name of fx.request.files) form.append('file', new Blob(['x']), name);
    return { method, body: form };
  }
  if (fx.request?.body !== undefined)
    return { method, body: JSON.stringify(fx.request.body), headers: { 'Content-Type': 'application/json' } };
  return { method };
}

/** 读事件流并解析；返回事件、每个事件到达的时间，以及是否以出错结束 */
async function readSse(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  const times: number[] = [];
  let buf = '';
  let broken = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) {
          events.push({ event, data: JSON.parse(data) } as SseEvent);
          times.push(performance.now());
        }
      }
    }
  } catch {
    broken = true;
  }
  return { events, times, broken };
}

const restOk = Object.entries(fixtures).filter((e): e is [string, RestFixture] => e[1].kind === 'ok');
const restErr = Object.entries(fixtures).filter((e): e is [string, RestFixture] => e[1].kind === 'error');

describe('MSW · REST 成功样例', () => {
  it.each(restOk)('%s', async (file, fx) => {
    setMockScenario(fx.endpoint, file);
    const res = await fetch(urlFor(fx.endpoint, fx), initFor(fx.endpoint, fx));
    expect(res.status).toBe(fx.status);
    if (fx.content_type && fx.content_type !== 'application/json') {
      expect(res.headers.get('Content-Type')).toContain(fx.content_type);
      expect(await res.text()).toBe(fx.body);
    } else {
      expect(await res.json()).toEqual(fx.body);
    }
  });

  it('不指定场景时按路径参数选中对应变体（证据 → 历史对话）', async () => {
    const fx = fixtures['get-evidence-eid.message.ok.json'] as RestFixture;
    const res = await fetch(urlFor(fx.endpoint, fx));
    expect(await res.json()).toEqual(fx.body);
  });

  it('不指定场景时按路径参数命中错误样例（不存在的项目 → 404）', async () => {
    const fx = fixtures['get-projects-pid-conversations.error.json'] as RestFixture;
    const res = await fetch(urlFor(fx.endpoint, fx));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(fx.body);
  });
});

describe('MSW · REST 错误样例', () => {
  it.each(restErr)('%s', async (file, fx) => {
    // 不带变体名的错误样例走场景 'error'；带变体名的（F6b：post-plugins-id.not-adapted.error.json）按文件名指定
    const variant = file.split('.').length > 3;
    setMockScenario(fx.endpoint, variant ? file : 'error');
    const res = await fetch(urlFor(fx.endpoint, fx), initFor(fx.endpoint, fx));
    expect(res.status).toBe(fx.status);
    expect(await res.json()).toEqual(fx.body);
  });
});

describe('MSW · 每个接口都有成功与错误样例', () => {
  it.each(ENDPOINTS.map((d) => `${d.method} ${d.path}`))('%s', (key) => {
    const all = Object.values(fixtures).filter((f) => f.endpoint === key);
    expect(all.some((f) => f.kind !== 'error')).toBe(true);
    expect(all.some((f) => f.kind === 'error')).toBe(true);
  });
});

describe('MSW · 事件流', () => {
  it('完整回合逐条推送，事件与 fixture 一致，间隔约 80 ms', async () => {
    const fx = fixtures['sse-turn-full.json'] as SseFixture;
    const res = await fetch(urlFor(fx.endpoint, fx), initFor(fx.endpoint, fx));
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const { events, times, broken } = await readSse(res);
    expect(broken).toBe(false);
    expect(events).toEqual(fx.events);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    // 定时器有抖动，且相邻两块可能被合并读出；取中位数判断节奏
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    expect(median).toBeGreaterThanOrEqual(SSE_INTERVAL_MS * 0.8);
    expect(times[times.length - 1] - times[0]).toBeGreaterThanOrEqual(SSE_INTERVAL_MS * (events.length - 1) * 0.8);
  });

  it('取消回合：以 message.end(cancelled=true) 结束', async () => {
    const fx = fixtures['sse-turn-cancel.json'] as SseFixture;
    setMockScenario(fx.endpoint, 'sse-turn-cancel.json');
    const { events } = await readSse(await fetch(urlFor(fx.endpoint, fx), initFor(fx.endpoint, fx)));
    expect(events).toEqual(fx.events);
    const end = events[events.length - 1];
    expect(end.event === 'message.end' && end.data.cancelled).toBe(true);
  });

  it('失败回合：以 error 结束', async () => {
    const fx = fixtures['sse-turn-error.json'] as SseFixture;
    setMockScenario(fx.endpoint, 'sse-turn-error.json');
    const { events } = await readSse(await fetch(urlFor(fx.endpoint, fx), initFor(fx.endpoint, fx)));
    expect(events).toEqual(fx.events);
  });

  it('重新生成：事件流与 fixture 一致', async () => {
    const fx = fixtures['post-messages-mid-regenerate.ok.json'] as SseFixture;
    const { events } = await readSse(await fetch(urlFor(fx.endpoint, fx), initFor(fx.endpoint, fx)));
    expect(events).toEqual(fx.events);
  });

  it('第 5 个事件后断线，用 after_seq=5 续流取回其余事件', async () => {
    const fx = fixtures['sse-turn-resume.json'] as SseFixture;
    setMockScenario(fx.endpoint, 'sse-turn-resume.json');
    const first = await readSse(await fetch(urlFor(fx.endpoint, fx), initFor(fx.endpoint, fx)));
    expect(first.broken).toBe(true);
    expect(first.events).toEqual(fx.events.slice(0, 5));

    const start = first.events[0];
    expect(start.event).toBe('message.start');
    const mid = start.event === 'message.start' ? start.data.message_id : '';
    const lastSeq = first.events[first.events.length - 1].data.seq;
    const rest = await readSse(await fetch(`${BASE}/api/messages/${mid}/events?after_seq=${lastSeq}`));
    expect(rest.broken).toBe(false);
    expect([...first.events, ...rest.events]).toEqual(fx.events);
    expect(rest.events).toEqual((fixtures['get-messages-mid-events.ok.json'] as SseFixture).events);
  });

  it('续流的 mid 不存在时返回 404 错误体', async () => {
    const res = await fetch(`${BASE}/api/messages/msg_missing/events?after_seq=0`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual((fixtures['get-messages-mid-events.error.json'] as RestFixture).body);
  });
});
