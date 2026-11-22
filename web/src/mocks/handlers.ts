// MSW handler：所有 REST 接口都从 docs/contract/fixtures/*.json 取响应；事件流按 fixture 逐条推送，每条间隔 80 ms。
//
// 选样例的顺序：
//   1. 用 setMockScenario 指定了场景（'ok' | 'error' | 某个 fixture 文件名）→ 用指定的；
//   2. 请求的路径参数与某份成功样例的 request.params 完全一致 → 用它（sse-turn-cancel/error/resume 只能用场景指定）；
//   3. 与某份错误样例的 request.params 一致（如 pid=prj_missing）→ 返回该错误；
//   4. 否则用该接口不带变体名的成功样例。
// `GET /api/messages/{mid}/events` 特殊：在所有事件流样例里找 message_id = mid 的回合，补发 seq > after_seq 的事件。
import { http, HttpResponse, type HttpHandler } from 'msw';
import { ENDPOINTS, endpointSlug, type EndpointDef } from '../api/endpoints';
import type { SseEvent } from '../api/types';
import type { Fixture, RestFixture, SseFixture } from './fixture-types';

export const SSE_INTERVAL_MS = 80;

const modules = import.meta.glob<Fixture>('../../../docs/contract/fixtures/*.json', { eager: true, import: 'default' });

/** 文件名 → fixture */
export const fixtures: Record<string, Fixture> = Object.fromEntries(
  Object.entries(modules).map(([path, fx]) => [path.slice(path.lastIndexOf('/') + 1), fx]),
);

const keyOf = (d: Pick<EndpointDef, 'method' | 'path'>) => `${d.method} ${d.path}`;

// ---------------------------------------------------------------- 场景开关（测试与手动调试用）
type Scenario = 'ok' | 'error' | string;
const scenarios = new Map<string, Scenario>();
/** endpoint 写成契约里的样子，如 `GET /api/projects`；scenario 为 'ok' | 'error' | fixture 文件名 */
export function setMockScenario(endpoint: string, scenario: Scenario): void {
  scenarios.set(endpoint, scenario);
}
export function resetMockScenarios(): void {
  scenarios.clear();
}

// ---------------------------------------------------------------- 选样例
function filesFor(def: EndpointDef) {
  const key = keyOf(def);
  const all = Object.entries(fixtures).filter(([, fx]) => fx.endpoint === key);
  const oks = all.filter(([, fx]) => fx.kind !== 'error');
  const errors = all.filter(([, fx]) => fx.kind === 'error');
  // 默认成功样例：文件名恰为 <slug>.ok.json；事件流接口默认用 sse-turn-full.json
  const slug = endpointSlug(def);
  const preferred =
    oks.find(([f]) => f === `${slug}.ok.json`) ?? oks.find(([f]) => f === 'sse-turn-full.json') ?? oks[0];
  return { oks, errors, preferred };
}

const sameParams = (fx: Fixture, params: Record<string, string>) => {
  const want = fx.request?.params ?? {};
  const keys = Object.keys(want);
  return keys.length > 0 && keys.every((k) => params[k] === want[k]);
};

function pick(def: EndpointDef, params: Record<string, string>): Fixture | undefined {
  const { oks, errors, preferred } = filesFor(def);
  const scenario = scenarios.get(keyOf(def));
  if (scenario === 'error') return errors[0]?.[1];
  if (scenario && scenario !== 'ok') return fixtures[scenario];
  if (!scenario) {
    // 取消/失败/断线等回合只在指定场景时使用，不参与按参数自动匹配
    const candidates = oks.filter(([f]) => !f.startsWith('sse-turn-') || f === preferred?.[0]);
    const hitOk = candidates.find(([, fx]) => sameParams(fx, params));
    if (hitOk) return hitOk[1];
    const hitErr = errors.find(([, fx]) => sameParams(fx, params));
    if (hitErr) return hitErr[1];
  }
  return preferred?.[1];
}

// ---------------------------------------------------------------- 事件流
const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function formatSse(e: SseEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

/** 逐条推送；disconnectAfterSeq 有值时推完该 seq 后让连接出错（模拟断线） */
function sseStream(events: SseEvent[], disconnectAfterSeq?: number): ReadableStream<Uint8Array> {
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const e of events) {
        await sleep(SSE_INTERVAL_MS);
        if (cancelled) return;
        controller.enqueue(encoder.encode(formatSse(e)));
        if (disconnectAfterSeq !== undefined && e.data.seq >= disconnectAfterSeq) {
          controller.error(new TypeError('模拟断线'));
          return;
        }
      }
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
}

const sseHeaders = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' };

function respond(fx: Fixture): Response {
  if (fx.kind === 'sse') {
    const s = fx as SseFixture;
    return new HttpResponse(sseStream(s.events, s.disconnect_after_seq), { status: 200, headers: sseHeaders });
  }
  const r = fx as RestFixture;
  if (r.content_type && r.content_type !== 'application/json') {
    return new HttpResponse(String(r.body), { status: r.status, headers: { 'Content-Type': r.content_type } });
  }
  return HttpResponse.json(r.body as object, { status: r.status });
}

function resumeResponse(def: EndpointDef, mid: string, afterSeq: number): Response {
  const scenario = scenarios.get(keyOf(def));
  if (scenario === 'error') return respond(filesFor(def).errors[0][1]);
  const turn = Object.values(fixtures).find(
    (fx): fx is SseFixture =>
      fx.kind === 'sse' && fx.events[0]?.event === 'message.start' && fx.events[0].data.message_id === mid,
  );
  if (!turn) {
    const notFound = filesFor(def).errors[0]?.[1];
    return notFound
      ? respond(notFound)
      : HttpResponse.json({ error: { code: 'NOT_FOUND', message: '消息不存在', retriable: false } }, { status: 404 });
  }
  return new HttpResponse(sseStream(turn.events.filter((e) => e.data.seq > afterSeq)), {
    status: 200,
    headers: sseHeaders,
  });
}

// ---------------------------------------------------------------- 组装
// 前缀 `*` 匹配任意源：浏览器里是 dev server 同源请求，Node 测试里是 http://localhost/...
const toMswPath = (p: string) => `*${p.replace(/\{(\w+)\}/g, ':$1')}`;
const METHOD = { GET: http.get, POST: http.post, PUT: http.put, DELETE: http.delete } as const;

// 静态路径先注册，避免 `/api/plugins/{id}` 抢走 `/api/skills/import` 这类请求（MSW 按注册顺序匹配）
const ordered = [...ENDPOINTS].sort((a, b) => Number(a.path.includes('{')) - Number(b.path.includes('{')));

export const handlers: HttpHandler[] = ordered.map((def) =>
  METHOD[def.method](toMswPath(def.path), ({ params, request }) => {
    const p = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
    if (keyOf(def) === 'GET /api/messages/{mid}/events') {
      const after = Number(new URL(request.url).searchParams.get('after_seq') ?? '0');
      return resumeResponse(def, p.mid, after);
    }
    const fx = pick(def, p);
    if (!fx)
      return HttpResponse.json(
        { error: { code: 'INTERNAL', message: `没有 ${keyOf(def)} 的样例`, retriable: false } },
        { status: 500 },
      );
    return respond(fx);
  }),
);
