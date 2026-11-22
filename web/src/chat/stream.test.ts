// F3：SSE 客户端与 useChat 的发送/续流/停止/重新生成（规格 1-对话栏-流式连接、1-输入框-发送停止按钮、1-助手回答-重新生成与切换）。
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { formatSse } from '../mocks/handlers';
import { parseSseBlock, sendMessageStream } from '../api/sse';
import type { ConversationTree, SendMessageBody, SseEvent } from '../api/types';
import type { SseFixture } from '../mocks/fixture-types';
import { fixtures, setMockScenario } from '../mocks/handlers';
import { draftKey, useChat } from '../store/chat';
import { seen, server, setupF3Msw } from '../test/f3-utils';

setupF3Msw();
/** 对话 cnv_transformer 的主线草稿 key（U37） */
const K = draftKey('cnv_transformer');

const full = fixtures['sse-turn-full.json'] as SseFixture;
const fullText = full.events.flatMap((e) => (e.event === 'delta' ? [e.data.text] : [])).join('');
const posts = () => seen.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'));
const waitStatus = (status: string, timeout = 8000) =>
  vi.waitFor(() => expect(useChat.getState().streaming?.status).toBe(status), { timeout, interval: 20 });

const body = (over: Partial<SendMessageBody> = {}): SendMessageBody => ({
  client_msg_id: crypto.randomUUID(),
  content: '问题',
  web_search: true,
  scope: { mode: 'all' },
  ...over,
});

describe('parseSseBlock', () => {
  it('解析事件、忽略 : ping 注释与未知事件', () => {
    expect(parseSseBlock(': ping')).toBeNull();
    expect(parseSseBlock('event: unknown\ndata: {"seq":1}')).toBeNull();
    expect(parseSseBlock('event: delta\ndata: {bad')).toBeNull();
    const e = parseSseBlock(': ping\nevent: delta\ndata: {"seq":3,"text":"x"}');
    expect(e).toEqual({ event: 'delta', data: { seq: 3, text: 'x' } });
  });
});

describe('useChat.send（MSW 完整回合）', () => {
  it('请求体带 web_search / scope / forced_skill，档位写进 X-Model-Tier；回合按顺序走到 saved', async () => {
    useChat.getState().setDraft(K, {
      text: '结合第 5 讲课件讲讲',
      web_search: false,
      scope: { mode: 'selected', document_ids: ['doc_attention', 'doc_l05_attention'] },
      forced_skill: 'pdf',
    });
    useChat.getState().send({ conversation_id: 'cnv_transformer', parent_id: 'msg_tf_a2', model_tier: 'fast' });
    // 乐观：立即有 turn，草稿已清空
    expect(useChat.getState().turn).toMatchObject({
      kind: 'send',
      content: '结合第 5 讲课件讲讲',
      parent_id: 'msg_tf_a2',
    });
    expect(useChat.getState().composer[K]).toMatchObject({ text: '', scope: { mode: 'all' }, attachments: [] });
    expect(useChat.getState().composer[K].forced_skill).toBeUndefined();

    const statuses = new Set<string>();
    const unsub = useChat.subscribe((s) => s.streaming && statuses.add(s.streaming.status));
    await waitStatus('saved');
    unsub();
    expect([...statuses]).toEqual(['streaming', 'verifying', 'saved']);

    const req = posts()[0];
    expect(req.headers['x-model-tier']).toBe('fast');
    expect(req.body).toMatchObject({
      web_search: false,
      scope: { mode: 'selected', document_ids: ['doc_attention', 'doc_l05_attention'] },
      forced_skill: 'pdf',
      parent_id: 'msg_tf_a2',
    });
    const s = useChat.getState().streaming!;
    expect(s.text).toBe(fullText);
    // forced_skill：模拟后端补了 kind=load_skill 的步骤
    expect(s.steps.some((x) => x.kind === 'load_skill')).toBe(true);
    expect(useChat.getState().turn?.user_message_id).toMatch(/^msg_/);
  });

  it('保存后树里出现这一轮（用户消息 + 回答），并成为 active_leaf', async () => {
    useChat.getState().setDraft(K, { text: '追问' });
    useChat.getState().send({ conversation_id: 'cnv_transformer', parent_id: 'msg_tf_a2' });
    await waitStatus('saved');
    const tree = await api.get<ConversationTree>('/api/conversations/cnv_transformer/tree');
    const mid = useChat.getState().streaming!.message_id;
    expect(tree.active_leaf_id).toBe(mid);
    const a = tree.messages.find((m) => m.id === mid)!;
    expect(a.content).toBe(fullText);
    expect(tree.messages.find((m) => m.id === a.parent_id)).toMatchObject({ role: 'user', content: '追问' });
  });

  it('同一 client_msg_id 重发不重复建消息', async () => {
    const b = body({ content: '同一条' });
    const run = (resolve: () => void) =>
      sendMessageStream('cnv_transformer', b, {
        onEvent: (e) => e.event === 'message.end' && resolve(),
      });
    await new Promise<void>((r) => run(r));
    await new Promise<void>((r) => run(r));
    const tree = await api.get<ConversationTree>('/api/conversations/cnv_transformer/tree');
    expect(tree.messages.filter((m) => m.content === '同一条')).toHaveLength(1);
  });
});

describe('断线续流', () => {
  it('第 5 个事件后断开：1 s 后续流，内容完整、无重复字符', async () => {
    setMockScenario('POST /api/conversations/{cid}/messages', 'sse-turn-resume.json');
    const resume = fixtures['sse-turn-resume.json'] as SseFixture;
    const expected = resume.events.flatMap((e) => (e.event === 'delta' ? [e.data.text] : [])).join('');
    const conns: string[] = [];
    const unsub = useChat.subscribe((s) => s.turn && conns.push(s.turn.connection));
    useChat.getState().setDraft(draftKey('cnv_resume_demo'), { text: '续流' });
    useChat.getState().send({ conversation_id: 'cnv_resume_demo' });
    await waitStatus('saved', 10000);
    unsub();
    expect(useChat.getState().streaming!.text).toBe(expected);
    expect(useChat.getState().streaming!.last_seq).toBe(22);
    expect(conns).toContain('reconnecting');
    expect(useChat.getState().turn?.connection).toBe('live');
    expect(seen.some((r) => r.path === '/api/messages/msg_rs_a1/events?after_seq=5')).toBe(true);
  }, 15000);

  it('续流连续三次失败：保留内容并交给 onGiveUp', async () => {
    setMockScenario('POST /api/conversations/{cid}/messages', 'sse-turn-resume.json');
    server.use(http.get('*/api/messages/:mid/events', () => HttpResponse.error()));
    const events: SseEvent[] = [];
    const reconnects: number[] = [];
    const lastSeq = await new Promise<number>((resolve) =>
      sendMessageStream(
        'cnv_resume_demo',
        body(),
        { onEvent: (e) => events.push(e), onReconnecting: (n) => reconnects.push(n), onGiveUp: resolve },
        { retryDelaysMs: [5, 5, 5] },
      ),
    );
    expect(lastSeq).toBe(5);
    expect(events).toHaveLength(5);
    expect(reconnects).toEqual([1, 2, 3]);
  });

  it('message.start 之前断开：用同一个 client_msg_id 重新 POST', async () => {
    let n = 0;
    server.use(
      http.post('*/api/conversations/:cid/messages', () => {
        n += 1;
        if (n === 1) return HttpResponse.error();
        return undefined;
      }),
    );
    const b = body();
    await new Promise<void>((resolve) =>
      sendMessageStream(
        'cnv_transformer',
        b,
        { onEvent: (e) => e.event === 'message.end' && resolve() },
        {
          retryDelaysMs: [5, 5, 5],
        },
      ),
    );
    const ids = posts().map((r) => (r.body as SendMessageBody).client_msg_id);
    expect(ids).toEqual([b.client_msg_id, b.client_msg_id]);
  });

  it('超过空闲时长没有数据视为断开，随后续流；: ping 不算事件', async () => {
    const start = full.events[0];
    const rest = full.events.slice(1);
    server.use(
      http.post('*/api/conversations/:cid/messages', () => {
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(': ping\n\n'));
            c.enqueue(enc.encode(formatSse(start)));
            // 之后不再有数据，也不关闭
          },
        });
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
      http.get('*/api/messages/:mid/events', ({ request }) => {
        const after = Number(new URL(request.url).searchParams.get('after_seq'));
        const text = rest
          .filter((e) => e.data.seq > after)
          .map(formatSse)
          .join('');
        return new HttpResponse(text, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );
    const events: SseEvent[] = [];
    const reconnects: number[] = [];
    await new Promise<void>((resolve) =>
      sendMessageStream(
        'cnv_transformer',
        body(),
        {
          onEvent: (e) => {
            events.push(e);
            if (e.event === 'message.end') resolve();
          },
          onReconnecting: (k) => reconnects.push(k),
        },
        { retryDelaysMs: [5, 5, 5], idleTimeoutMs: 150 },
      ),
    );
    expect(reconnects).toEqual([1]);
    expect(events.map((e) => e.data.seq)).toEqual(full.events.map((e) => e.data.seq));
    expect(seen.some((r) => r.path.endsWith('/events?after_seq=1'))).toBe(true);
  });
});

describe('停止与重新生成', () => {
  it('中途停止：保留已生成正文，已出现标记的引用以 partial 发出，以 cancelled 结束', async () => {
    useChat.getState().setDraft(K, { text: '停一下' });
    useChat.getState().send({ conversation_id: 'cnv_transformer', parent_id: 'msg_tf_a2' });
    await vi.waitFor(() => expect(useChat.getState().streaming?.text ?? '').toContain('[[E1]]'), {
      timeout: 5000,
      interval: 10,
    });
    await useChat.getState().cancel();
    await waitStatus('cancelled');
    const s = useChat.getState().streaming!;
    expect(s.text.length).toBeGreaterThan(0);
    expect(s.text.length).toBeLessThan(fullText.length);
    expect(s.citations.length).toBeGreaterThan(0);
    expect(s.citations.every((c) => c.verdict === 'partial')).toBe(true);
    expect(seen.some((r) => r.method === 'POST' && r.path === `/api/messages/${s.message_id}/cancel`)).toBe(true);
  });

  it('error 事件：状态 error，turn 带错误信息', async () => {
    setMockScenario('POST /api/conversations/{cid}/messages', 'sse-turn-error.json');
    useChat.getState().setDraft(K, { text: 'x' });
    useChat.getState().send({ conversation_id: 'cnv_transformer' });
    await waitStatus('error');
    expect(useChat.getState().turn?.error).toMatchObject({ code: 'MODEL_UNAVAILABLE', retriable: true });
  });

  it('重新生成：新回答是兄弟节点并成为 active_leaf；切回原回答恢复原路径', async () => {
    useChat.getState().regenerate('msg_tf_a1', { conversation_id: 'cnv_transformer', parent_id: 'msg_tf_u1' });
    expect(useChat.getState().turn).toMatchObject({ kind: 'regenerate', regenerate_of: 'msg_tf_a1' });
    await waitStatus('saved');
    const mid = useChat.getState().streaming!.message_id;
    let tree = await api.get<ConversationTree>('/api/conversations/cnv_transformer/tree');
    expect(tree.active_leaf_id).toBe(mid);
    expect(tree.messages.find((m) => m.id === mid)?.parent_id).toBe('msg_tf_u1');
    const r = await api.put<{ active_leaf_id: string }>('/api/conversations/cnv_transformer/active_leaf', {
      message_id: 'msg_tf_a1',
    });
    expect(r.active_leaf_id).toBe('msg_tf_a2');
    tree = await api.get<ConversationTree>('/api/conversations/cnv_transformer/tree');
    expect(tree.active_leaf_id).toBe('msg_tf_a2');
  });
});
