// 有状态的对话模拟层（F3）：让 MSW 能演示“主页发送后建对话并出现在项目栏”“连续多轮追问”“重新生成兄弟回答并切换”
// “中途停止”“同一 client_msg_id 重发不重复建消息”。
// 事件内容一律取自 docs/contract/fixtures 的事件流样例（sse-turn-full、post-messages-mid-regenerate），只改写本轮的
// message_id、user_message_id、client_msg_id、step_id、citation_id 与 seq；`forced_skill` 时补一个 load_skill 步骤（R4：演示数据只在 mocks）。
// 规则同 world.ts：某接口用 setMockScenario 指定了场景时，本层不处理，交回 handlers.ts 按 fixture 应答。
// F5 追加：分支（POST /api/branches、POST /api/branches/{bid}/merge、PUT /api/branches/{bid}）——新建的分支与合并卡片写进本层状态，
// 树里随之出现；merge 返回一条 merge_note 消息并把分支置为 merged，主线叶子移到这条消息。另导出 leafGuardHandlers：
// 证据与网页快照接口接受可选 `leaf_id`（契约 v0.4），不是已有消息时按契约返回 VALIDATION_ERROR。
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { ActiveLeafResult, MergeResult, UpdateBranchBody } from '../api/endpoints';
import type {
  Branch,
  Citation,
  CreateBranchBody,
  Conversation,
  ConversationTree,
  Evidence,
  ID,
  Message,
  SendMessageBody,
  SseEvent,
  Step,
} from '../api/types';
import { defaultBranchTitle } from '../branch/model';
import { cpLength, parseCitations, sliceByCp, stripCitations } from '../lib/citations';
import type { RestFixture, SseFixture } from './fixture-types';
import { fixtures, formatSse, getMockScenario, SSE_INTERVAL_MS } from './handlers';
import { upsertConversationSummary } from './world';

const fx = <T>(file: string) => fixtures[file] as T;
const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const deferred = (endpoint: string) => getMockScenario(endpoint) !== undefined;

/** 一轮回答（发送或重新生成） */
interface Run {
  conversation_id: ID;
  assistant: Message;
  user?: Message;
  events: SseEvent[];
  /** 事件全部推完的时刻；之前树里看不到这一轮 */
  readyAt: number;
  /** 正在推送中：停止请求会把它置 true */
  cancelRequested: boolean;
  streaming: boolean;
}

interface ConvState {
  conversation: Conversation;
  /** 来自 fixture 的基础树（新建对话为空） */
  base: ConversationTree | null;
  runs: Run[];
  /** 显式切换过的叶子（PUT active_leaf）及时间 */
  leafOverride?: { id: ID; at: number };
  /** F5 追加：本层改过的分支表（新建、合并、归档）；为空时用 fixture 的 */
  branches?: Branch[];
  /** F5 追加：合并产生的 merge_note 消息 */
  notes?: Message[];
}

interface ChatWorld {
  convs: Map<ID, ConvState>;
  byClientMsg: Map<string, Run>;
  byMessage: Map<ID, Run>;
  seq: number;
}

function initial(): ChatWorld {
  return { convs: new Map(), byClientMsg: new Map(), byMessage: new Map(), seq: 0 };
}
let w = initial();

export function resetChatWorld(): void {
  w = initial();
}

/** 全部事件流样例里出现过的证据（GET /api/evidence/{eid} 没有 REST 样例时用它应答） */
function evidenceIndex(): Map<ID, Evidence> {
  const idx = new Map<ID, Evidence>();
  for (const f of Object.values(fixtures)) {
    if (f.kind !== 'sse') continue;
    for (const e of (f as SseFixture).events) {
      if (e.event !== 'evidence' || idx.has(e.data.eid)) continue;
      const d = e.data;
      const ev: Evidence = {
        id: d.eid,
        source_type: d.source_type,
        source_id: d.source_id,
        title: d.title,
        locator: d.locator,
        quote: d.quote,
        cited_by: [],
      };
      if (d.sha256) ev.sha256 = d.sha256;
      idx.set(d.eid, ev);
    }
  }
  return idx;
}

const fixtureTree = () =>
  structuredClone(fx<RestFixture>('get-conversations-cid-tree.ok.json').body as ConversationTree);

/** 取对话状态；fixture 里的那段对话首次访问时登记 */
function conv(cid: ID): ConvState | undefined {
  const hit = w.convs.get(cid);
  if (hit) return hit;
  const base = fixtureTree();
  if (base.conversation.id !== cid) return undefined;
  const st: ConvState = { conversation: base.conversation, base, runs: [] };
  w.convs.set(cid, st);
  return st;
}

/** F5 追加：当前分支表（本层改过的优先） */
function branchesOf(st: ConvState): Branch[] {
  return st.branches ?? st.base?.branches ?? [];
}

function visibleRuns(st: ConvState): Run[] {
  const t = now();
  return st.runs.filter((r) => !r.streaming && r.readyAt <= t);
}

function allMessages(st: ConvState): Message[] {
  const out = [...(st.base?.messages ?? []), ...(st.notes ?? [])];
  for (const r of visibleRuns(st)) {
    if (r.user) out.push(r.user);
    out.push(r.assistant);
  }
  return out;
}

/** 从某条消息往下沿主线（branch_id 为空）找最深的叶子；多个孩子取最新的 */
function deepestLeaf(messages: Message[], from: ID): ID {
  let cur = from;
  for (;;) {
    const kids = messages.filter((m) => m.parent_id === cur && !m.branch_id);
    if (kids.length === 0) return cur;
    cur = kids.sort((a, b) => a.created_at.localeCompare(b.created_at))[kids.length - 1].id;
  }
}

function effectiveLeaf(st: ConvState, messages: Message[]): ID | undefined {
  let leaf = st.base?.active_leaf_id;
  let at = -1;
  if (st.leafOverride) {
    leaf = st.leafOverride.id;
    at = st.leafOverride.at;
  }
  for (const r of visibleRuns(st)) {
    if (!r.assistant.branch_id && r.readyAt > at) {
      leaf = r.assistant.id;
      at = r.readyAt;
    }
  }
  return leaf && messages.some((m) => m.id === leaf) ? leaf : undefined;
}

function treeOf(st: ConvState): ConversationTree {
  const messages = allMessages(st);
  const leaf = effectiveLeaf(st, messages);
  const conversation: Conversation = { ...st.conversation };
  const root = messages.find((m) => !m.parent_id);
  if (root) conversation.root_message_id = root.id;
  if (leaf) conversation.active_leaf_id = leaf;
  const tree: ConversationTree = { conversation, messages, branches: branchesOf(st) };
  if (leaf) tree.active_leaf_id = leaf;
  return tree;
}

/** 改写样例事件：本轮 id、seq 重排；可在 message.start 后插入额外步骤 */
function rewrite(
  template: SseEvent[],
  ids: { message_id: ID; user_message_id: ID; client_msg_id: string; parent_id?: ID; branch_id?: ID; tag: string },
  extraSteps: Step[] = [],
): SseEvent[] {
  const out: SseEvent[] = [];
  for (const e of template) {
    switch (e.event) {
      case 'message.start': {
        const data: Extract<SseEvent, { event: 'message.start' }>['data'] = {
          seq: 0,
          message_id: ids.message_id,
          client_msg_id: ids.client_msg_id,
          user_message_id: ids.user_message_id,
        };
        if (ids.parent_id) data.parent_id = ids.parent_id;
        if (ids.branch_id) data.branch_id = ids.branch_id;
        out.push({ event: 'message.start', data });
        for (const s of extraSteps) {
          out.push({ event: 'step', data: { ...s, status: 'running', seq: 0 } });
          out.push({ event: 'step', data: { ...s, seq: 0 } });
        }
        break;
      }
      case 'step':
        out.push({ event: 'step', data: { ...e.data, step_id: `${e.data.step_id}_${ids.tag}` } });
        break;
      case 'citation':
        out.push({ event: 'citation', data: { ...e.data, citation_id: `${e.data.citation_id}_${ids.tag}` } });
        break;
      case 'message.end':
        out.push({ event: 'message.end', data: { ...e.data, message_id: ids.message_id } });
        break;
      default:
        out.push(structuredClone(e));
    }
  }
  return out.map((e, i) => ({ ...e, data: { ...e.data, seq: i + 1 } }) as SseEvent);
}

/** 由事件得到入库后的助手消息 */
function assistantFrom(events: SseEvent[], base: Omit<Message, 'content' | 'role' | 'created_at'>): Message {
  const steps = new Map<ID, Step>();
  const citations: Citation[] = [];
  let content = '';
  let usage: Message['usage'];
  for (const e of events) {
    if (e.event === 'delta') content += e.data.text;
    if (e.event === 'step') {
      const { seq: _s, ...st } = e.data;
      steps.set(st.step_id, st);
    }
    if (e.event === 'citation') {
      const { seq: _s, ...c } = e.data;
      citations.push(c);
    }
    if (e.event === 'message.end') usage = e.data.usage;
  }
  const m: Message = {
    ...base,
    role: 'assistant',
    content,
    model: 'chat-model',
    created_at: iso(),
    steps: [...steps.values()],
    citations,
  };
  if (usage) m.usage = usage;
  return m;
}

/** 停止：未推的正文丢弃；已出现标记的引用以 partial 发出（句末截到已生成正文），然后 message.end(cancelled) */
function cancelTail(sent: SseEvent[], template: SseEvent[]): SseEvent[] {
  const text = sent.flatMap((e) => (e.event === 'delta' ? [e.data.text] : [])).join('');
  const labels = new Set(parseCitations(text).markers.map((m) => m.label));
  const plainLen = cpLength(stripCitations(text));
  const sentCitations = new Set(sent.flatMap((e) => (e.event === 'citation' ? [e.data.citation_id] : [])));
  let seq = sent[sent.length - 1]?.data.seq ?? 0;
  const tail: SseEvent[] = [];
  for (const e of template) {
    if (e.event !== 'citation' || !labels.has(e.data.label) || sentCitations.has(e.data.citation_id)) continue;
    seq += 1;
    tail.push({
      event: 'citation',
      data: {
        ...e.data,
        sentence_start: Math.min(e.data.sentence_start, plainLen),
        sentence_end: Math.min(e.data.sentence_end, plainLen),
        verdict: 'partial',
        seq,
      },
    });
  }
  const end = template.find((e) => e.event === 'message.end');
  if (end && end.event === 'message.end') {
    seq += 1;
    tail.push({ event: 'message.end', data: { ...end.data, cancelled: true, seq } });
  }
  return tail;
}

const encoder = new TextEncoder();
const sseHeaders = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' };

/** 推送一轮；afterSeq 用于续流与重放 */
function streamRun(run: Run, afterSeq = 0): Response {
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let i = run.events.findIndex((e) => e.data.seq > afterSeq);
      if (i < 0) i = run.events.length;
      while (i < run.events.length) {
        await sleep(SSE_INTERVAL_MS);
        if (closed) return;
        if (run.cancelRequested && run.streaming) {
          // 停止：截断并补尾
          const template = run.events;
          const sent = template.slice(0, i);
          run.events = [...sent, ...cancelTail(sent, template)];
          run.assistant = assistantFrom(run.events, {
            id: run.assistant.id,
            conversation_id: run.assistant.conversation_id,
            ...(run.assistant.parent_id ? { parent_id: run.assistant.parent_id } : {}),
            ...(run.assistant.branch_id ? { branch_id: run.assistant.branch_id } : {}),
          });
          run.readyAt = now();
          stampAnswerTime(run);
          run.cancelRequested = false;
        }
        const e = run.events[i];
        controller.enqueue(encoder.encode(formatSse(e)));
        i += 1;
      }
      run.streaming = false;
      if (!closed) controller.close();
    },
    cancel() {
      // 客户端断开：服务端照常生成完（续流时可取回），只是不再推给这条连接
      closed = true;
      run.streaming = false;
    },
  });
  return new HttpResponse(body, { status: 200, headers: sseHeaders });
}

/**
 * 回答的 created_at = 用户消息 created_at + 本轮 message.end.latency_ms，与契约 fixture 的关系一致
 * （前端用两者之差推算历史消息的整轮耗时，编排决定 U35）。重新生成的回答没有用户消息，保留生成时刻。
 */
function stampAnswerTime(run: Run): void {
  if (!run.user) return;
  const end = run.events.find((e) => e.event === 'message.end');
  const latency = end && end.event === 'message.end' ? end.data.latency_ms : 0;
  const t = Date.parse(run.user.created_at) + latency;
  run.assistant = { ...run.assistant, created_at: new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

function newRun(
  st: ConvState,
  events: SseEvent[],
  user: Message | undefined,
  assistantBase: Omit<Message, 'content' | 'role' | 'created_at'>,
): Run {
  const run: Run = {
    conversation_id: st.conversation.id,
    user,
    assistant: assistantFrom(events, assistantBase),
    events,
    readyAt: now() + events.length * SSE_INTERVAL_MS,
    cancelRequested: false,
    streaming: true,
  };
  st.runs.push(run);
  w.byMessage.set(run.assistant.id, run);
  return run;
}

function touchSummary(st: ConvState) {
  const c = st.conversation;
  upsertConversationSummary(c.project_id, {
    id: c.id,
    title: c.title,
    updated_at: c.updated_at,
    // F5：不计 archived（编排决定 U47），原来只计 open
    branch_count: branchesOf(st).filter((b) => b.status !== 'archived').length,
  });
}

const PLACEHOLDER_TITLE = (fx<RestFixture>('post-projects-pid-conversations.ok.json').body as Conversation).title;
/** F4：代码问答回合的触发材料（sse-turn-code.json 的 scope.document_ids） */
const CODE_DOC = ((fx<SseFixture>('sse-turn-code.json').request?.body as SendMessageBody | undefined)?.scope
  .document_ids ?? [])[0];

export const chatWorldHandlers: HttpHandler[] = [
  http.post('*/api/projects/:pid/conversations', async ({ params, request }) => {
    if (deferred('POST /api/projects/{pid}/conversations')) return undefined;
    const input = (await request.json().catch(() => ({}))) as { title?: unknown };
    w.seq += 1;
    const t = iso();
    const conversation: Conversation = {
      id: `cnv_new${w.seq}`,
      project_id: String(params.pid),
      title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : PLACEHOLDER_TITLE,
      created_at: t,
      updated_at: t,
    };
    const st: ConvState = { conversation, base: null, runs: [] };
    w.convs.set(conversation.id, st);
    touchSummary(st);
    return HttpResponse.json(conversation);
  }),

  http.get('*/api/conversations/:cid/tree', ({ params }) => {
    if (deferred('GET /api/conversations/{cid}/tree')) return undefined;
    const st = conv(String(params.cid));
    return st ? HttpResponse.json(treeOf(st)) : undefined;
  }),

  http.post('*/api/conversations/:cid/messages', async ({ params, request }) => {
    if (deferred('POST /api/conversations/{cid}/messages')) return undefined;
    const st = conv(String(params.cid));
    if (!st) return undefined;
    const body = (await request.json()) as SendMessageBody;
    // 同一 client_msg_id：返回同一条消息的事件流（契约：不重复建消息）
    const again = w.byClientMsg.get(body.client_msg_id);
    if (again) return streamRun(again);

    w.seq += 1;
    const tag = `m${w.seq}`;
    const ids = {
      message_id: `msg_${tag}_a`,
      user_message_id: `msg_${tag}_u`,
      client_msg_id: body.client_msg_id,
      tag,
      ...(body.parent_id ? { parent_id: body.parent_id } : {}),
      ...(body.branch_id ? { branch_id: body.branch_id } : {}),
    };
    const extra: Step[] = body.forced_skill
      ? [
          {
            step_id: `stp_${tag}_skill`,
            kind: 'load_skill',
            label: `加载 Skill：${body.forced_skill}`,
            status: 'done',
            duration_ms: 120,
          },
        ]
      : [];
    // F4 追加：@ 引用了 transformer.py 的提问用代码问答回合（引用代码 L7、历史对话“作业 3”、网页快照），其余仍用 sse-turn-full
    const codeTurn = body.scope?.mode === 'selected' && (body.scope.document_ids ?? []).includes(CODE_DOC);
    const events = rewrite(fx<SseFixture>(codeTurn ? 'sse-turn-code.json' : 'sse-turn-full.json').events, ids, extra);
    const t = iso();
    const user: Message = {
      id: ids.user_message_id,
      conversation_id: st.conversation.id,
      role: 'user',
      content: body.content,
      created_at: t,
      ...(body.parent_id ? { parent_id: body.parent_id } : {}),
      ...(body.branch_id ? { branch_id: body.branch_id } : {}),
    };
    const run = newRun(st, events, user, {
      id: ids.message_id,
      conversation_id: st.conversation.id,
      parent_id: user.id,
      ...(body.branch_id ? { branch_id: body.branch_id } : {}),
    });
    w.byClientMsg.set(body.client_msg_id, run);
    stampAnswerTime(run);
    // 标题由后端保证非空（U21）：新对话首条消息后用用户原文前 20 字
    if (st.conversation.title === PLACEHOLDER_TITLE && body.content.trim()) {
      st.conversation = { ...st.conversation, title: Array.from(body.content.trim()).slice(0, 20).join('') };
    }
    st.conversation = { ...st.conversation, updated_at: t };
    touchSummary(st);
    return streamRun(run);
  }),

  http.get('*/api/messages/:mid/events', ({ params, request }) => {
    if (deferred('GET /api/messages/{mid}/events')) return undefined;
    const run = w.byMessage.get(String(params.mid));
    if (!run) return undefined;
    const after = Number(new URL(request.url).searchParams.get('after_seq') ?? '0');
    return streamRun(run, after);
  }),

  http.post('*/api/messages/:mid/regenerate', ({ params }) => {
    if (deferred('POST /api/messages/{mid}/regenerate')) return undefined;
    const mid = String(params.mid);
    const st =
      [...w.convs.values()].find((s) => allMessages(s).some((m) => m.id === mid)) ??
      conv(fixtureTree().conversation.id);
    const original = st && allMessages(st).find((m) => m.id === mid);
    if (!st || !original || original.role !== 'assistant' || !original.parent_id) return undefined;
    w.seq += 1;
    const tag = `r${w.seq}`;
    const tpl = fx<SseFixture>('post-messages-mid-regenerate.ok.json').events;
    const start = tpl[0].event === 'message.start' ? tpl[0].data : null;
    const events = rewrite(tpl, {
      message_id: `msg_${tag}_a`,
      user_message_id: original.parent_id,
      client_msg_id: start?.client_msg_id ?? '',
      tag,
      ...(original.branch_id ? { branch_id: original.branch_id } : {}),
    });
    const run = newRun(st, events, undefined, {
      id: `msg_${tag}_a`,
      conversation_id: st.conversation.id,
      parent_id: original.parent_id,
      ...(original.branch_id ? { branch_id: original.branch_id } : {}),
    });
    return streamRun(run);
  }),

  http.post('*/api/messages/:mid/cancel', ({ params }) => {
    if (deferred('POST /api/messages/{mid}/cancel')) return undefined;
    const run = w.byMessage.get(String(params.mid));
    if (!run) return undefined;
    if (run.streaming) run.cancelRequested = true;
    return HttpResponse.json({ ok: true });
  }),

  http.put('*/api/conversations/:cid/active_leaf', async ({ params, request }) => {
    if (deferred('PUT /api/conversations/{cid}/active_leaf')) return undefined;
    const st = conv(String(params.cid));
    if (!st) return undefined;
    const { message_id } = (await request.json()) as { message_id: ID };
    const messages = allMessages(st);
    if (!messages.some((m) => m.id === message_id))
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: '消息不存在', retriable: false } },
        { status: 404 },
      );
    const leaf = deepestLeaf(messages, message_id);
    st.leafOverride = { id: leaf, at: now() };
    return HttpResponse.json({ active_leaf_id: leaf } satisfies ActiveLeafResult);
  }),

  http.get('*/api/evidence/:eid', ({ params }) => {
    if (deferred('GET /api/evidence/{eid}')) return undefined;
    const eid = String(params.eid);
    // 有 REST 样例的交回 fixture 层
    const hasRest = Object.values(fixtures).some(
      (f) => f.endpoint === 'GET /api/evidence/{eid}' && f.request?.params?.eid === eid,
    );
    if (hasRest) return undefined;
    const ev = evidenceIndex().get(eid);
    return ev ? HttpResponse.json(ev) : undefined;
  }),

  // ---------------------------------------------------------------- F5 追加：分支
  http.post('*/api/branches', async ({ request }) => {
    if (deferred('POST /api/branches')) return undefined;
    const body = (await request.json().catch(() => ({}))) as Partial<CreateBranchBody>;
    const st = body.conversation_id ? conv(body.conversation_id) : undefined;
    if (!st) return apiError(404, 'NOT_FOUND', '对话不存在');
    const fork = allMessages(st).find((m) => m.id === body.fork_message_id);
    if (!fork) return apiError(404, 'NOT_FOUND', 'fork 消息不存在');
    const a = body.anchor;
    if (fork.role !== 'assistant' || !a || !Number.isInteger(a.start) || !Number.isInteger(a.end) || a.end <= a.start)
      return apiError(400, 'VALIDATION_ERROR', '锚点不合法');
    // 锚点必须与 fork 消息去标记纯文本的这一段一致（码点、左闭右开）
    if (sliceByCp(stripCitations(fork.content), a.start, a.end) !== a.quote)
      return apiError(400, 'VALIDATION_ERROR', '锚点原句与偏移不一致');
    const sample = fx<RestFixture>('post-branches.ok.json');
    const sampleReq = sample.request?.body as CreateBranchBody | undefined;
    const same =
      sampleReq &&
      sampleReq.conversation_id === body.conversation_id &&
      sampleReq.fork_message_id === body.fork_message_id &&
      sampleReq.anchor.start === a.start &&
      sampleReq.anchor.end === a.end &&
      !branchesOf(st).some((b) => b.id === (sample.body as Branch).id);
    w.seq += 1;
    // 主线前 N 轮：从根到 fork 消息路径上的用户消息数
    const byId = new Map(allMessages(st).map((m) => [m.id, m]));
    let turns = 0;
    for (let cur: Message | undefined = fork; cur; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined)
      if (cur.role === 'user' && !cur.branch_id) turns += 1;
    const branch: Branch = same
      ? { ...(structuredClone(sample.body) as Branch), created_at: iso() }
      : {
          id: `br_new${w.seq}`,
          conversation_id: st.conversation.id,
          fork_message_id: fork.id,
          anchor_start: a.start,
          anchor_end: a.end,
          anchor_quote: a.quote,
          // 规格“标题默认取 quote 前 12 字”；契约请求没有 title，由后端生成（未决 U48）
          title: defaultBranchTitle(a.quote),
          status: 'open',
          created_at: iso(),
          context_turns: turns,
        };
    st.branches = [...branchesOf(st), branch];
    touchSummary(st);
    return HttpResponse.json(branch);
  }),

  http.post('*/api/branches/:bid/merge', async ({ params }) => {
    if (deferred('POST /api/branches/{bid}/merge')) return undefined;
    const bid = String(params.bid);
    const st = convOfBranch(bid);
    const branch = st && branchesOf(st).find((b) => b.id === bid);
    if (!st || !branch) return apiError(404, 'NOT_FOUND', '分支不存在');
    if (branch.status !== 'open') return apiError(400, 'VALIDATION_ERROR', '分支已合并或已归档');
    await sleep(MERGE_DELAY_MS); // “合并中”：后端要总结要点，约数秒
    const messages = allMessages(st);
    const leaf = effectiveLeaf(st, messages);
    const sample = fx<RestFixture>('post-branches-bid-merge.ok.json').body as MergeResult;
    w.seq += 1;
    let content: string;
    if (sample.branch.id === bid) content = sample.merge_note.content;
    else {
      // 模拟“总结要点”：取分支最后一条回答的第一句
      const answers = messages
        .filter((m) => m.branch_id === bid && m.role === 'assistant')
        .sort((x, y) => x.created_at.localeCompare(y.created_at));
      const last = answers[answers.length - 1];
      const first = last ? (stripCitations(last.content).split(/(?<=[。！？.!?])/)[0] ?? '') : '';
      content = `分支「${branch.title}」要点：${Array.from(first).slice(0, 80).join('')}`;
    }
    const note: Message = {
      id: sample.branch.id === bid ? sample.merge_note.id : `msg_merge${w.seq}`,
      conversation_id: st.conversation.id,
      role: 'merge_note',
      content,
      created_at: iso(),
      ...(leaf ? { parent_id: leaf } : {}),
    };
    const merged: Branch = { ...branch, status: 'merged', merged_into_message_id: note.id };
    st.branches = branchesOf(st).map((b) => (b.id === bid ? merged : b));
    st.notes = [...(st.notes ?? []), note];
    st.leafOverride = { id: note.id, at: now() };
    st.conversation = { ...st.conversation, updated_at: note.created_at };
    touchSummary(st);
    return HttpResponse.json({ branch: merged, merge_note: note } satisfies MergeResult);
  }),

  http.put('*/api/branches/:bid', async ({ params, request }) => {
    if (deferred('PUT /api/branches/{bid}')) return undefined;
    const bid = String(params.bid);
    const st = convOfBranch(bid);
    const branch = st && branchesOf(st).find((b) => b.id === bid);
    if (!st || !branch) return apiError(404, 'NOT_FOUND', '分支不存在');
    const body = (await request.json().catch(() => ({}))) as Partial<UpdateBranchBody> & Record<string, unknown>;
    let next: Branch;
    if ('status' in body && body.status === 'archived') next = { ...branch, status: 'archived' };
    else if ('title' in body && typeof body.title === 'string' && body.title.trim())
      next = { ...branch, title: body.title.trim() };
    else return apiError(400, 'VALIDATION_ERROR', '只能归档或改标题');
    st.branches = branchesOf(st).map((b) => (b.id === bid ? next : b));
    touchSummary(st);
    return HttpResponse.json(next);
  }),
];

/** F5：合并时模拟“后端总结要点”的耗时 */
export const MERGE_DELAY_MS = 600;

function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, retriable: false } }, { status });
}

/** F5：分支所在对话（fixture 的那段对话首次访问时登记） */
function convOfBranch(bid: ID): ConvState | undefined {
  conv(fixtureTree().conversation.id);
  return [...w.convs.values()].find((s) => branchesOf(s).some((b) => b.id === bid));
}

/** F5：某个消息 id 是否存在（任一对话） */
function messageExists(mid: ID): boolean {
  conv(fixtureTree().conversation.id);
  return [...w.convs.values()].some((s) => allMessages(s).some((m) => m.id === mid));
}

/**
 * F5 追加（契约 v0.4，编排决定 U44）：证据与网页快照接受可选 query `leaf_id`。
 * 不是已有消息 → 400 VALIDATION_ERROR；否则交给后面的层按原样应答（模拟层不做路径可见性过滤，那是后端 B1/B3 的事）。
 * 排在 chatWorldHandlers 之前注册。
 */
export const leafGuardHandlers: HttpHandler[] = [
  http.get('*/api/evidence/:eid', ({ request }) => {
    if (deferred('GET /api/evidence/{eid}')) return undefined;
    const leaf = new URL(request.url).searchParams.get('leaf_id');
    if (leaf !== null && !messageExists(leaf)) return apiError(400, 'VALIDATION_ERROR', 'leaf_id 不是已有消息');
    return undefined;
  }),
  http.get('*/api/web_snapshots/:sid', ({ request }) => {
    if (deferred('GET /api/web_snapshots/{sid}')) return undefined;
    const leaf = new URL(request.url).searchParams.get('leaf_id');
    if (leaf !== null && !messageExists(leaf)) return apiError(400, 'VALIDATION_ERROR', 'leaf_id 不是已有消息');
    return undefined;
  }),
];

/** 调试与端到端测试用（挂在 window.__mnMock 上） */
export const chatWorldControls = { resetChatWorld };
