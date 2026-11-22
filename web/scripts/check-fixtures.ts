// 校验 docs/contract/fixtures/*.json：npm run check:fixtures（已并入 npm run check）
//
// 1. 结构：用 ts-json-schema-generator 从 src/api/types.ts（= docs/contract/types.ts 的拷贝）、
//    src/api/endpoints.ts、src/mocks/fixture-types.ts 生成 JSON Schema，禁止多余字段，再用 Ajv 校验。
// 2. 覆盖：解析 rest-api.md 的接口表，每个接口至少一份成功样例、一份错误样例；ENDPOINTS 与契约逐条一致。
// 3. 语义：错误码与 HTTP 状态、retriable 对得上；SSE seq 连续、开头/结尾事件正确、引用偏移落在正文内；
//    分支锚点、网页/历史对话证据的 quote 与原文切片一致；ID 前缀与时间格式符合 contract/README.md。
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { createGenerator } from 'ts-json-schema-generator';
import { ENDPOINTS, endpointSlug, type EndpointDef } from '../src/api/endpoints';
import type { Fixture, SseFixture } from '../src/mocks/fixture-types';
import type { SseEvent } from '../src/api/types';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..');
const contractDir = resolve(webDir, '../docs/contract');
const fixturesDir = join(contractDir, 'fixtures');

const problems: string[] = [];
const fail = (where: string, msg: string) => problems.push(`${where}: ${msg}`);

// ---------------------------------------------------------------- 0. types.ts 两处一致
const contractTypes = readFileSync(join(contractDir, 'types.ts'), 'utf8');
const webTypes = readFileSync(join(webDir, 'src/api/types.ts'), 'utf8');
if (contractTypes !== webTypes) fail('web/src/api/types.ts', '与 docs/contract/types.ts 不一致（两处必须逐字相同）');

// ---------------------------------------------------------------- 1. 生成 schema
const definitions: Record<string, unknown> = {};
for (const rel of ['src/api/types.ts', 'src/api/endpoints.ts', 'src/mocks/fixture-types.ts']) {
  const part = createGenerator({
    path: join(webDir, rel),
    tsconfig: join(webDir, 'tsconfig.json'),
    type: '*',
    expose: 'export',
    additionalProperties: false,
    skipTypeCheck: true,
    topRef: true,
  }).createSchema('*') as { definitions?: Record<string, unknown> };
  Object.assign(definitions, part.definitions ?? {});
}
const schema = { definitions };

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ ...schema, $id: 'contract' });
const validators = new Map<string, ValidateFunction>();
function validatorFor(typeName: string): ValidateFunction {
  let v = validators.get(typeName);
  if (!v) {
    const defs = (schema as { definitions?: Record<string, unknown> }).definitions ?? {};
    if (!defs[typeName]) throw new Error(`schema 里没有类型 ${typeName}`);
    v = ajv.compile({ $ref: `contract#/definitions/${typeName}` });
    validators.set(typeName, v);
  }
  return v;
}
function check(where: string, typeName: string, value: unknown) {
  const v = validatorFor(typeName);
  if (!v(value)) {
    for (const e of v.errors ?? []) {
      fail(
        where,
        `不符合 ${typeName}：${e.instancePath || '(根)'} ${e.message}${e.params && 'additionalProperty' in e.params ? `（多余字段 ${String(e.params.additionalProperty)}）` : ''}`,
      );
    }
  }
}

// ---------------------------------------------------------------- 2. 解析 rest-api.md
const restMd = readFileSync(join(contractDir, 'rest-api.md'), 'utf8');
const mdEndpoints = new Set<string>();
for (const m of restMd.matchAll(/^\|\s*(GET|POST|PUT|DELETE)\s*\|\s*`([^`]+)`/gm)) {
  mdEndpoints.add(`${m[1]} ${m[2].split('?')[0]}`);
}
const codeTable = new Map<string, { http: number; retriable: boolean | null }>();
for (const m of restMd.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*(\d{3})\s*\|[^|]*\|\s*(true|false|—)\s*\|/gm)) {
  codeTable.set(m[1], { http: Number(m[2]), retriable: m[3] === '—' ? null : m[3] === 'true' });
}
const defByKey = new Map<string, EndpointDef>(ENDPOINTS.map((d) => [`${d.method} ${d.path}`, d]));
for (const k of mdEndpoints) if (!defByKey.has(k)) fail('endpoints.ts', `rest-api.md 有 ${k}，ENDPOINTS 缺这一条`);
for (const k of defByKey.keys()) if (!mdEndpoints.has(k)) fail('endpoints.ts', `ENDPOINTS 有 ${k}，rest-api.md 里没有`);
if (codeTable.size < 9) fail('rest-api.md', `错误码表只解析到 ${codeTable.size} 行`);

// ---------------------------------------------------------------- 3. 逐个 fixture
const PREFIXES = ['prj_', 'cnv_', 'msg_', 'br_', 'doc_', 'evd_', 'cit_', 'ws_', 'mem_', 'job_', 'plg_', 'skl_'];
const KEY_PREFIX: Record<string, string[]> = {
  project_id: ['prj_'],
  conversation_id: ['cnv_'],
  message_id: ['msg_'],
  parent_id: ['msg_'],
  user_message_id: ['msg_'],
  fork_message_id: ['msg_'],
  merged_into_message_id: ['msg_'],
  root_message_id: ['msg_'],
  active_leaf_id: ['msg_'],
  branch_id: ['br_'],
  eid: ['evd_'],
  citation_id: ['cit_'],
  snapshot_id: ['ws_'],
  plugin_id: ['plg_'],
  job_id: ['job_'],
  source_id: ['doc_', 'ws_', 'msg_', 'plg_'],
  id: PREFIXES,
};
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function walk(where: string, value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(where, v, `${path}[${i}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    const p = `${path}.${k}`;
    if (typeof v === 'string') {
      const allowed = KEY_PREFIX[k];
      if (allowed && !allowed.some((pre) => v.startsWith(pre)))
        fail(where, `${p}="${v}" 前缀应为 ${allowed.join(' / ')}`);
      if ((k.endsWith('_at') || k === 'valid_from' || k === 'valid_to') && !ISO_Z.test(v))
        fail(where, `${p}="${v}" 不是带 Z 的 ISO 8601`);
    }
    if (
      Array.isArray(v) &&
      (k === 'job_ids' || k === 'source_message_ids' || k === 'enabled_plugin_ids' || k === 'document_ids')
    ) {
      const pre = { job_ids: 'job_', source_message_ids: 'msg_', enabled_plugin_ids: 'plg_', document_ids: 'doc_' }[k];
      v.forEach(
        (x, i) => typeof x === 'string' && !x.startsWith(pre) && fail(where, `${p}[${i}]="${x}" 前缀应为 ${pre}`),
      );
    }
    walk(where, v, p);
  }
}

const stripMarkers = (s: string) => s.replace(/\[\[E\d+\]\]/g, '');

function checkSse(where: string, fx: SseFixture, replayAfter?: number) {
  fx.events.forEach((e, i) => check(`${where} events[${i}]`, 'SseEvent', e));
  const ev = fx.events;
  if (ev.length === 0) return fail(where, '没有事件');
  const firstSeq = replayAfter === undefined ? 1 : replayAfter + 1;
  ev.forEach((e, i) => {
    if (e.data.seq !== firstSeq + i) fail(where, `第 ${i + 1} 个事件 seq=${e.data.seq}，应为 ${firstSeq + i}`);
  });
  if (replayAfter === undefined && ev[0].event !== 'message.start') fail(where, '第一个事件必须是 message.start');
  const last = ev[ev.length - 1];
  if (last.event !== 'message.end' && last.event !== 'error') fail(where, '最后一个事件必须是 message.end 或 error');
  if (ev.slice(0, -1).some((e) => e.event === 'message.end' || e.event === 'error'))
    fail(where, 'message.end / error 之后还有事件');

  // step：同一 step_id 先 running 后 done/error
  const stepState = new Map<string, string>();
  for (const e of ev) {
    if (e.event !== 'step') continue;
    const prev = stepState.get(e.data.step_id);
    if (e.data.status === 'running' && prev) fail(where, `step ${e.data.step_id} 重复 running`);
    if (e.data.status !== 'running' && prev !== 'running' && replayAfter === undefined)
      fail(where, `step ${e.data.step_id} 未先 running 就 ${e.data.status}`);
    stepState.set(e.data.step_id, e.data.status);
  }
  if (replayAfter !== undefined) return; // 续流片段缺前文，其余检查在原回合上做

  const labels = new Map<string, string>();
  for (const e of ev) if (e.event === 'evidence') labels.set(e.data.label, e.data.eid);
  const text = ev
    .filter((e): e is Extract<SseEvent, { event: 'delta' }> => e.event === 'delta')
    .map((e) => e.data.text)
    .join('');
  for (const m of text.matchAll(/\[\[(E\d+)\]\]/g))
    if (!labels.has(m[1])) fail(where, `正文引用了 ${m[1]}，但没有对应 evidence 事件`);
  const plain = stripMarkers(text);
  let sawCitation = false;
  for (const e of ev) {
    if (e.event === 'delta' && sawCitation) fail(where, 'citation 之后又出现 delta（引用校验应在正文生成完毕之后）');
    if (e.event !== 'citation') continue;
    sawCitation = true;
    const c = e.data;
    if (labels.get(c.label) !== c.eid)
      fail(where, `citation ${c.citation_id} 的 label ${c.label} 与 eid ${c.eid} 对不上`);
    if (!(0 <= c.sentence_start && c.sentence_start < c.sentence_end && c.sentence_end <= plain.length))
      fail(
        where,
        `citation ${c.citation_id} 偏移 [${c.sentence_start}, ${c.sentence_end}) 超出正文（${plain.length} 字）`,
      );
  }
  const end = ev.find((e) => e.event === 'message.end');
  const start = ev[0];
  if (end && start.event === 'message.start' && end.data.message_id !== start.data.message_id)
    fail(where, 'message.end 与 message.start 的 message_id 不一致');
  if (end && end.event === 'message.end' && end.data.cancelled) {
    for (const e of ev)
      if (e.event === 'citation' && e.data.verdict !== 'partial') fail(where, '取消回合里的引用必须全部是 partial');
  }
}

const fixtureFiles = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .sort();
const loaded = new Map<string, Fixture>();
const coverage = new Map<string, { ok: number; error: number }>();
for (const d of ENDPOINTS) coverage.set(`${d.method} ${d.path}`, { ok: 0, error: 0 });

for (const file of fixtureFiles) {
  let fx: Fixture;
  try {
    fx = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as Fixture;
  } catch (e) {
    fail(file, `不是合法 JSON：${(e as Error).message}`);
    continue;
  }
  loaded.set(file, fx);
  check(file, 'Fixture', fx);
  const def = defByKey.get(fx.endpoint);
  if (!def) {
    fail(file, `endpoint "${fx.endpoint}" 不在契约里`);
    continue;
  }
  const isTurn = file.startsWith('sse-turn-');
  if (!isTurn) {
    const m = file.match(/^(.+?)(\.[a-z0-9-]+)?\.(ok|error)\.json$/);
    if (!m) fail(file, '文件名应为 <接口>.[变体.]ok|error.json 或 sse-turn-*.json');
    else {
      if (m[1] !== endpointSlug(def)) fail(file, `文件名前缀应为 ${endpointSlug(def)}`);
      const expectKind = m[3] === 'ok' ? ['ok', 'sse'] : ['error'];
      if (!expectKind.includes(fx.kind)) fail(file, `文件名是 ${m[3]}，内容 kind=${fx.kind}`);
    }
  }
  // 路径参数齐全
  for (const m of def.path.matchAll(/\{(\w+)\}/g)) {
    if (!fx.request?.params?.[m[1]]) fail(file, `缺路径参数 request.params.${m[1]}`);
  }
  if (def.request && fx.kind !== 'error' && fx.request?.body === undefined)
    fail(file, `接口要求请求体 ${def.request}，样例缺 request.body`);
  if (def.request && fx.request?.body !== undefined && fx.kind !== 'error')
    check(`${file} request.body`, def.request, fx.request.body);
  walk(file, fx);

  const cov = coverage.get(fx.endpoint);
  if (fx.kind === 'error') {
    if (cov) cov.error += 1;
    check(`${file} body`, 'ApiError', fx.body);
    const code = (fx.body as { error?: { code?: string; retriable?: boolean } }).error;
    const row = code?.code ? codeTable.get(code.code) : undefined;
    if (!row) fail(file, `错误码 ${code?.code} 不在 rest-api.md 错误码表`);
    else {
      if (row.http !== fx.status) fail(file, `${code?.code} 的 HTTP 应为 ${row.http}，样例是 ${fx.status}`);
      if (row.retriable !== null && row.retriable !== code?.retriable)
        fail(file, `${code?.code} 的 retriable 应为 ${row.retriable}`);
    }
    continue;
  }
  if (cov) cov.ok += 1;
  if (fx.status < 200 || fx.status >= 300) fail(file, `成功样例的 status=${fx.status}`);
  if (fx.kind === 'sse') {
    if (def.response !== 'sse') fail(file, `${fx.endpoint} 不是事件流接口`);
    const after =
      fx.endpoint === 'GET /api/messages/{mid}/events' ? Number(fx.request?.query?.after_seq ?? 0) : undefined;
    checkSse(file, fx, after);
    continue;
  }
  if (def.response === 'sse') fail(file, `${fx.endpoint} 应返回事件流（kind=sse）`);
  else if (def.response === 'raw') {
    if (!fx.content_type || typeof fx.body !== 'string') fail(file, 'raw 样例需要 content_type 与字符串 body');
  } else check(`${file} body`, def.response, fx.body);
}

for (const [k, c] of coverage) {
  if (c.ok === 0) fail('覆盖', `${k} 缺成功样例`);
  if (c.error === 0) fail('覆盖', `${k} 缺错误样例`);
}

// ---------------------------------------------------------------- 4. 跨文件一致性
const body = <T>(file: string) => (loaded.get(file) as { body: T } | undefined)?.body;
const sseOf = (file: string) => loaded.get(file) as SseFixture | undefined;

// 4.1 SSE 三种回合
const full = sseOf('sse-turn-full.json');
if (!full) fail('覆盖', '缺 sse-turn-full.json');
else {
  const count = (name: string) => full.events.filter((e) => e.event === name).length;
  const stepIds = new Set(full.events.flatMap((e) => (e.event === 'step' ? [e.data.step_id] : [])));
  if (stepIds.size < 3) fail('sse-turn-full.json', `步骤 ${stepIds.size} 个，要求 3 个`);
  if (count('evidence') < 3) fail('sse-turn-full.json', `evidence ${count('evidence')} 条，要求 3 条`);
  if (count('delta') < 2) fail('sse-turn-full.json', 'delta 太少');
  const verdicts = new Set(full.events.flatMap((e) => (e.event === 'citation' ? [e.data.verdict] : [])));
  for (const v of ['supported', 'partial', 'removed'])
    if (!verdicts.has(v as never)) fail('sse-turn-full.json', `缺 verdict=${v} 的 citation`);
  if (full.events[full.events.length - 1].event !== 'message.end') fail('sse-turn-full.json', '应以 message.end 结束');
}
const cancel = sseOf('sse-turn-cancel.json');
if (!cancel) fail('覆盖', '缺 sse-turn-cancel.json');
else {
  const end = cancel.events.find((e) => e.event === 'message.end');
  if (!end || end.event !== 'message.end' || !end.data.cancelled)
    fail('sse-turn-cancel.json', '应以 message.end(cancelled=true) 结束');
}
const resume = sseOf('sse-turn-resume.json');
const replay = sseOf('get-messages-mid-events.ok.json');
if (!resume || resume.disconnect_after_seq === undefined)
  fail('覆盖', '缺带 disconnect_after_seq 的 sse-turn-resume.json');
else if (!replay) fail('覆盖', '缺 get-messages-mid-events.ok.json');
else {
  const n = resume.disconnect_after_seq;
  if (n !== 5) fail('sse-turn-resume.json', `disconnect_after_seq=${n}，要求 5`);
  const start = resume.events[0];
  if (start.event === 'message.start' && replay.request?.params?.mid !== start.data.message_id)
    fail('get-messages-mid-events.ok.json', 'mid 与续流回合的 message_id 不一致');
  if (replay.request?.query?.after_seq !== String(n)) fail('get-messages-mid-events.ok.json', `after_seq 应为 ${n}`);
  const expected = JSON.stringify(resume.events.filter((e) => e.data.seq > n));
  if (JSON.stringify(replay.events) !== expected)
    fail('get-messages-mid-events.ok.json', '补发的事件与 sse-turn-resume.json 中 seq>5 的部分不一致');
}

// 4.2 分支锚点与树内引用
type TreeT = {
  messages: {
    id: string;
    content: string;
    citations?: { sentence_start: number; sentence_end: number; citation_id: string }[];
  }[];
  branches: { id: string; fork_message_id: string; anchor_start: number; anchor_end: number; anchor_quote: string }[];
};
const tree = body<TreeT>('get-conversations-cid-tree.ok.json');
if (tree) {
  const byId = new Map(tree.messages.map((m) => [m.id, m]));
  for (const b of tree.branches) {
    const fork = byId.get(b.fork_message_id);
    if (!fork) {
      fail('get-conversations-cid-tree.ok.json', `分支 ${b.id} 的 fork 消息不在 messages 里`);
      continue;
    }
    const slice = stripMarkers(fork.content).slice(b.anchor_start, b.anchor_end);
    if (slice !== b.anchor_quote)
      fail(
        'get-conversations-cid-tree.ok.json',
        `分支 ${b.id} 锚点切片「${slice}」≠ anchor_quote「${b.anchor_quote}」`,
      );
  }
  for (const m of tree.messages) {
    const len = stripMarkers(m.content).length;
    for (const c of m.citations ?? [])
      if (c.sentence_end > len) fail('get-conversations-cid-tree.ok.json', `${m.id} 的 ${c.citation_id} 偏移超出正文`);
  }
}

// 4.3 证据 quote 与原文切片
const snap = body<{ id: string; text: string }>('get-web_snapshots-sid.ok.json');
for (const [file, fx] of loaded) {
  if (!file.startsWith('get-evidence-eid') || fx.kind !== 'ok') continue;
  const ev = fx.body as {
    quote: string;
    locator: Record<string, unknown>;
    context_messages?: { id: string; content: string }[];
  };
  if ('snapshot_id' in ev.locator && snap && ev.locator.snapshot_id === snap.id) {
    const [s, e] = ev.locator.char_range as [number, number];
    if (snap.text.slice(s, e) !== ev.quote) fail(file, 'web 证据 quote 与快照 text 的 char_range 切片不一致');
  }
  if ('message_id' in ev.locator) {
    const msg = ev.context_messages?.find((m) => m.id === ev.locator.message_id);
    if (!msg) fail(file, 'message 证据的 context_messages 里没有被引消息');
    else {
      const [s, e] = ev.locator.char_range as [number, number];
      if (stripMarkers(msg.content).slice(s, e) !== ev.quote)
        fail(file, 'message 证据 quote 与被引消息 char_range 切片不一致');
    }
  }
}

// ---------------------------------------------------------------- 输出
if (problems.length) {
  console.error(`fixture 校验失败：${problems.length} 处`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const covered = [...coverage.values()].filter((c) => c.ok && c.error).length;
console.log(
  `fixture 校验通过：${fixtureFiles.length} 份文件，${covered}/${ENDPOINTS.length} 个接口都有成功与错误样例，types.ts 两处一致`,
);
