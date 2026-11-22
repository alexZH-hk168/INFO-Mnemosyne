// F3：对话栏各规格（1-对话行-对话栏、1-对话栏-消息列表、1-消息列表-用户消息、1-消息列表-助手回答、1-助手回答-步骤行、
// 1-助手回答-证据胶囊、2-证据胶囊-原句浮层、1-助手回答-推断标记、1-助手回答-来源列表、1-助手回答-重新生成与切换、1-对话栏-流式连接）。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Citation } from '../api/types';
import { stripCitations } from '../lib/citations';
import { setMockScenario } from '../mocks/handlers';
import { draftKey, useChat, type Streaming } from '../store/chat';
import { useEvidence } from '../store/evidence';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';
import { renderWithClient, seen, setupF3Msw } from '../test/f3-utils';
import ChatColumn from './ChatColumn';

setupF3Msw();
/** 对话 cnv_transformer 的主线草稿 key（U37） */
const K = draftKey('cnv_transformer');
vi.setConfig({ testTimeout: 20000 });

const open = (cid = 'cnv_transformer') => {
  useChat.setState({ conversationId: cid });
  useLayout.setState({ view: 'conversation' });
  return renderWithClient(<ChatColumn />);
};
const loaded = () => screen.findByTestId('chat.assistant-message:msg_tf_a2', {}, { timeout: 5000 });

/** 直接摆一个流式状态（不经网络），用于逐状态检查 */
function stage(partial: Partial<Streaming>, turnPatch: Record<string, unknown> = {}) {
  useChat.setState({
    turn: {
      kind: 'send',
      conversation_id: 'cnv_transformer',
      client_msg_id: 'c1',
      content: '新问题',
      parent_id: 'msg_tf_a2',
      user_message_id: 'msg_s_u',
      connection: 'live',
      ...turnPatch,
    },
    streaming: {
      message_id: 'msg_s_a',
      client_msg_id: 'c1',
      last_seq: 1,
      steps: [],
      evidence: [],
      text: '',
      citations: [],
      status: 'streaming',
      ...partial,
    },
  });
}

describe('1-对话行-对话栏', () => {
  it('加载中显示骨架，加载后标题与主线消息', async () => {
    open();
    expect(screen.getByTestId('chat.panel.loading')).toBeInTheDocument();
    await loaded();
    expect(screen.getByTestId('chat.panel.title')).toHaveTextContent('Transformer 注意力精读');
    expect(screen.getByTestId('chat.user-message:msg_tf_u1')).toBeInTheDocument();
    expect(screen.getByTestId('composer.box')).toHaveAttribute('data-variant', 'chat');
  });

  it('NOT_FOUND：“对话不存在或已删除”，可回到主页', async () => {
    setMockScenario('GET /api/conversations/{cid}/tree', 'error');
    open('cnv_missing');
    expect(await screen.findByTestId('chat.panel.not-found')).toHaveTextContent('对话不存在或已删除');
    fireEvent.click(screen.getByTestId('chat.panel.go-home'));
    expect(useLayout.getState().view).toBe('home');
  });
});

describe('1-对话栏-消息列表 / 用户消息 / 助手回答', () => {
  it('只渲染主线路径（分支消息不出现）', async () => {
    open();
    await loaded();
    const list = screen.getByTestId('chat.message-list');
    expect(within(list).queryByTestId('chat.user-message:msg_bv_u1')).toBeNull();
    expect(
      within(list)
        .getAllByTestId(/^chat\.(user|assistant)-message:/)
        .map((e) => e.dataset.testid),
    ).toEqual([
      'chat.user-message:msg_tf_u1',
      'chat.assistant-message:msg_tf_a1',
      'chat.user-message:msg_tf_u2',
      'chat.assistant-message:msg_tf_a2',
    ]);
  });

  it('乐观插入：未确认时用户消息透明（data-pending），收到 message.start 后恢复', async () => {
    open();
    await loaded();
    act(() =>
      useChat.setState({
        turn: {
          kind: 'send',
          conversation_id: 'cnv_transformer',
          client_msg_id: 'c9',
          content: '乐观',
          connection: 'live',
        },
        streaming: null,
      }),
    );
    const u = screen.getByTestId('chat.user-message:pending:c9');
    expect(u).toHaveAttribute('data-pending', 'true');
    expect(screen.getByTestId('chat.assistant-message.thinking:pending')).toBeInTheDocument();
    act(() => stage({}, { client_msg_id: 'c9', content: '乐观' }));
    expect(screen.getByTestId('chat.user-message:msg_s_u')).not.toHaveAttribute('data-pending');
  });

  it('streaming：正文逐字、胶囊虚线待确认、步骤行转圈并显示当前步骤', async () => {
    open();
    await loaded();
    act(() =>
      stage({
        steps: [{ step_id: 's1', kind: 'search_materials', label: '检索项目材料', status: 'running' }],
        evidence: [
          {
            id: 'evd_att_p4_fn4',
            label: 'E1',
            source_type: 'material',
            source_id: 'doc_attention',
            title: 'Attention Is All You Need',
            locator: { page: 4, sentence_ids: [], bbox: [0, 0, 1, 1] },
            quote: 'q',
          },
        ],
        text: '方差是 dₖ[[E1]]。下一句[[E',
      }),
    );
    const a = screen.getByTestId('chat.assistant-message:msg_s_a');
    expect(a).toHaveAttribute('data-status', 'streaming');
    const chip = screen.getByTestId('chat.evidence-chip:msg_s_a:E1');
    expect(chip).toHaveAttribute('data-state', 'pending');
    expect(chip).toHaveTextContent('1 · p.4');
    // 半个标记不显示成字面量
    expect(screen.getByTestId('chat.answer-body:msg_s_a').textContent).not.toContain('[[E');
    const trail = screen.getByTestId('chat.step-trail:msg_s_a');
    expect(trail).toHaveAttribute('data-state', 'running');
    expect(trail).toHaveTextContent('检索项目材料');
    // 生成中：重新生成不可用，来源列表不出现
    expect(screen.queryByTestId('chat.source-list:msg_s_a')).toBeNull();
    expect(screen.getByTestId('chat.regenerate:msg_tf_a2')).toBeDisabled();
  });

  it('verifying：步骤行末尾“核对引用…”；saved：胶囊按 verdict 显示', async () => {
    open();
    await loaded();
    const c1: Citation = {
      citation_id: 'k1',
      eid: 'evd_att_p4_fn4',
      label: 'E1',
      sentence_start: 0,
      sentence_end: 7,
      verdict: 'supported',
    };
    act(() =>
      stage({
        steps: [{ step_id: 's1', kind: 'search_materials', label: '检索项目材料', status: 'done', duration_ms: 900 }],
        text: '方差是 dₖ[[E1]]。',
        citations: [c1],
        status: 'verifying',
      }),
    );
    expect(screen.getByTestId('chat.step-trail:msg_s_a')).toHaveTextContent('核对引用…');
    act(() => useChat.setState((s) => ({ streaming: { ...s.streaming!, status: 'saved' } })));
    expect(screen.getByTestId('chat.evidence-chip:msg_s_a:E1')).toHaveAttribute('data-state', 'supported');
  });

  it('cancelled：末尾“已停止生成”；error：红色提示与“重新生成”', async () => {
    open();
    await loaded();
    act(() => stage({ text: '一半', status: 'cancelled' }));
    expect(screen.getByTestId('chat.assistant-message.cancelled:msg_s_a')).toHaveTextContent('已停止生成');
    act(() =>
      stage(
        { text: '', status: 'error' },
        { error: { code: 'MODEL_UNAVAILABLE', message: '模型接口不可用，请检查设置里的 API Key', retriable: true } },
      ),
    );
    const err = screen.getByTestId('chat.assistant-message.error:msg_s_a');
    expect(err).toHaveTextContent('模型接口不可用');
    expect(within(err).getByTestId('chat.assistant-message.retry:msg_s_a')).toBeEnabled();
  });
});

describe('1-对话栏-流式连接（界面）', () => {
  it('重连中显示灰字；重连失败保留内容并给“重新生成”', async () => {
    open();
    await loaded();
    act(() => stage({ text: '已经生成的一段' }, { connection: 'reconnecting' }));
    expect(screen.getByTestId('chat.stream-client.reconnecting')).toHaveTextContent('连接中断，正在重连');
    act(() => useChat.setState((s) => ({ turn: { ...s.turn!, connection: 'lost' } })));
    expect(screen.getByTestId('chat.answer-body:msg_s_a')).toHaveTextContent('已经生成的一段');
    expect(screen.getByTestId('chat.assistant-message.error:msg_s_a')).toHaveTextContent('连接中断');
    // 失败后输入框恢复可发送
    expect(screen.getByTestId('composer.send')).not.toHaveAttribute('data-state', 'stop');
  });
});

describe('1-助手回答-证据胶囊 / 推断标记 / 来源列表', () => {
  it('fixture 回答：E1 supported、E2 partial（句末“推断”）、E3 removed 不渲染', async () => {
    open();
    await screen.findByTestId('chat.evidence-chip:msg_tf_a1:E1', {}, { timeout: 5000 });
    expect(screen.getByTestId('chat.evidence-chip:msg_tf_a1:E1')).toHaveAttribute('data-state', 'supported');
    expect(screen.getByTestId('chat.evidence-chip:msg_tf_a1:E2')).toHaveAttribute('data-state', 'partial');
    expect(screen.queryByTestId('chat.evidence-chip:msg_tf_a1:E3')).toBeNull();
    const mark = screen.getByTestId('chat.inference-mark:msg_tf_a1:cit_tf1_2');
    expect(mark).toHaveTextContent('推断');
    expect(mark).toHaveAttribute('title', '没有找到直接支持这句话的原文');
    await waitFor(() => expect(screen.getByTestId('chat.evidence-chip:msg_tf_a1:E1')).toHaveTextContent('1 · p.4'));
    // 来源列表：只列 supported 与 partial
    const src = screen.getByTestId('chat.source-list:msg_tf_a1');
    expect(within(src).getAllByTestId(/^chat\.source-list\.item:/)).toHaveLength(2);
    expect(within(src).queryByTestId('chat.source-list.item:evd_jalammar_scale')).toBeNull();
  });

  it('点击胶囊：useEvidence.select(eid, message_id) 并打开右栏标签；选中外圈', async () => {
    open();
    const chip = await screen.findByTestId('chat.evidence-chip:msg_tf_a1:E1', {}, { timeout: 5000 });
    await waitFor(() => expect(chip).toHaveTextContent('p.4'));
    fireEvent.click(chip);
    expect(useEvidence.getState().selectedEvidenceId).toBe('evd_att_p4_fn4');
    expect(useLayout.getState().rightTabs.some((t) => t.ref_id === 'doc_attention')).toBe(true);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('点击来源卡同点击胶囊', async () => {
    open();
    const card = await screen.findByTestId('chat.source-list.item:evd_l05_s18', {}, { timeout: 5000 });
    await waitFor(() => expect(card).toHaveTextContent('L05 注意力机制'));
    fireEvent.click(card);
    expect(useEvidence.getState().selectedEvidenceId).toBe('evd_l05_s18');
    expect(useLayout.getState().rightTabs.some((t) => t.ref_id === 'doc_l05_attention')).toBe(true);
  });

  it('来源超过 4 个折叠为 +N', async () => {
    open();
    await loaded();
    const ev = ['evd_att_p4_fn4', 'evd_l05_s18', 'evd_jalammar_scale', 'e4', 'e5', 'e6'];
    const cits: Citation[] = ev.map((eid, i) => ({
      citation_id: `k${i}`,
      eid,
      label: `E${i + 1}`,
      sentence_start: 0,
      sentence_end: 1,
      verdict: 'supported',
    }));
    act(() => stage({ text: ev.map((_, i) => `句${i}[[E${i + 1}]]。`).join(''), citations: cits, status: 'saved' }));
    const more = screen.getByTestId('chat.source-list.more:msg_s_a');
    expect(more).toHaveTextContent('+2');
    fireEvent.click(more);
    expect(within(screen.getByTestId('chat.source-list:msg_s_a')).getAllByTestId(/item:/)).toHaveLength(6);
  });
});

describe('2-证据胶囊-原句浮层', () => {
  it('悬停 300 ms 后出现（标题、位置、原句）；移出 150 ms 关闭；本地没有数据时读接口', async () => {
    open();
    const chip = await screen.findByTestId('chat.evidence-chip:msg_tf_a1:E1', {}, { timeout: 5000 });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.mouseEnter(chip);
      act(() => vi.advanceTimersByTime(200));
      expect(screen.queryByTestId('chat.evidence-hover')).toBeNull();
      act(() => vi.advanceTimersByTime(150));
      const hover = screen.getByTestId('chat.evidence-hover');
      await waitFor(() => expect(hover).toHaveTextContent('Attention Is All You Need'));
      expect(hover).toHaveTextContent('第 4 页');
      expect(hover).toHaveTextContent('To illustrate why the dot products get large');
      expect(seen.some((r) => r.path === '/api/evidence/evd_att_p4_fn4')).toBe(true);
      fireEvent.mouseLeave(chip);
      act(() => vi.advanceTimersByTime(200));
      expect(screen.queryByTestId('chat.evidence-hover')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('1-助手回答-步骤行', () => {
  it('摘要与 UI-05 格式一致，展开后列出每一步', async () => {
    open();
    const trail = await screen.findByTestId('chat.step-trail:msg_tf_a1', {}, { timeout: 5000 });
    await waitFor(() => expect(trail).toHaveTextContent('检索 2 份材料、1 个网页，参考 1 段历史对话'));
    expect(trail).toHaveTextContent('3 步 · 9 秒'); // U35：整轮耗时，历史消息 = 06:20:09 − 06:20:00
    expect(trail.textContent).not.toContain('记忆');
    fireEvent.click(trail);
    const detail = screen.getByTestId('chat.step-trail.detail:msg_tf_a1');
    expect(within(detail).getAllByTestId(/^chat\.step-trail\.step:/)).toHaveLength(3);
    expect(detail.textContent).not.toContain('记忆');
  });

  it('有失败步骤：该步红色，摘要末尾“1 步失败”', async () => {
    open();
    await loaded();
    act(() =>
      stage({
        steps: [{ step_id: 'x', kind: 'fetch_url', label: '抓取网页：example.com', status: 'error', duration_ms: 500 }],
        text: '答',
        status: 'saved',
      }),
    );
    const trail = screen.getByTestId('chat.step-trail:msg_s_a');
    expect(trail).toHaveAttribute('data-state', 'error');
    expect(trail).toHaveTextContent('1 步失败');
  });

  it('秒数是整轮耗时（U35）：流式中不显示，message.end 后取 latency_ms；不知道就不显示', async () => {
    open();
    await loaded();
    const steps = [
      {
        step_id: 'x',
        kind: 'search_materials' as const,
        label: '检索项目材料',
        status: 'done' as const,
        duration_ms: 900,
      },
    ];
    act(() => stage({ steps, text: '答', status: 'streaming' }));
    const trail = screen.getByTestId('chat.step-trail:msg_s_a');
    expect(trail).toHaveTextContent('1 步');
    expect(trail.textContent).not.toMatch(/秒/);
    act(() => useChat.setState((s) => ({ streaming: { ...s.streaming!, status: 'saved', latency_ms: 4210 } })));
    expect(trail).toHaveTextContent('1 步 · 4 秒');
    // 历史里 msg_tf_a2 的用户消息与回答相隔 5 秒
    expect(screen.getByTestId('chat.step-trail:msg_tf_a2')).toHaveTextContent('1 步 · 5 秒');
  });

  it('以 error 结束（没有 message.end）：用 error 与 message.start 的本地时刻差', () => {
    useChat.setState({ streaming: null, turn: null });
    const t0 = Date.now();
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(t0)
      .mockReturnValueOnce(t0 + 2600);
    useChat.getState().applyEvent({
      event: 'message.start',
      data: { seq: 1, message_id: 'm', client_msg_id: 'c', user_message_id: 'u' },
    });
    useChat.getState().applyEvent({
      event: 'error',
      data: { seq: 2, code: 'MODEL_UNAVAILABLE', message: 'x', retriable: true },
    });
    expect(useChat.getState().streaming).toMatchObject({ status: 'error', latency_ms: 2600 });
    vi.restoreAllMocks();
  });
});

describe('1-助手回答-重新生成与切换 / 复制', () => {
  it('复制得到去掉 [[E#]] 的纯文本', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    open();
    await loaded();
    fireEvent.click(screen.getByTestId('chat.regenerate.copy:msg_tf_a1'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0] as string;
    expect(text).not.toMatch(/\[\[E\d+\]\]/);
    expect(text).toBe(stripCitations(text));
    expect(useUI.getState().toasts.some((t) => t.text === '已复制')).toBe(true);
  });

  it('重新生成：新回答成为兄弟并切换过去，显示 2/2；‹ 切回原回答 1/2', async () => {
    open();
    await loaded();
    fireEvent.click(screen.getByTestId('chat.regenerate:msg_tf_a1'));
    // 生成中：原回答从列表里截掉，后面接新回答
    await waitFor(() => expect(screen.queryByTestId('chat.assistant-message:msg_tf_a1')).toBeNull());
    await waitFor(() => expect(useChat.getState().streaming?.status).toBe('saved'), { timeout: 8000 });
    const mid = useChat.getState().streaming!.message_id;
    const count = await screen.findByTestId(`chat.regenerate.count:${mid}`, {}, { timeout: 5000 });
    expect(count).toHaveTextContent('2/2');
    expect(useChat.getState().turn).toBeNull(); // 树里已有，乐观显示已清掉
    fireEvent.click(screen.getByTestId(`chat.regenerate.prev:${mid}`));
    const back = await screen.findByTestId('chat.regenerate.count:msg_tf_a1', {}, { timeout: 5000 });
    expect(back).toHaveTextContent('1/2');
    // 切回原回答恢复原路径（后面的追问又出现）
    expect(screen.getByTestId('chat.assistant-message:msg_tf_a2')).toBeInTheDocument();
    expect(seen.some((r) => r.method === 'PUT' && r.path.endsWith('/active_leaf'))).toBe(true);
  });
});

describe('完整回合（对话栏 + MSW）', () => {
  it('发送后：用户消息、步骤行、正文与胶囊依次出现，保存后进入树并可继续追问', async () => {
    open();
    await loaded();
    act(() => useChat.getState().setDraft(K, { text: '那多头注意力里，每个头的 dₖ 是多少？' }));
    fireEvent.click(screen.getByTestId('composer.send'));
    await waitFor(() => expect(useChat.getState().streaming?.status).toBe('saved'), { timeout: 8000 });
    const mid = useChat.getState().streaming!.message_id;
    await waitFor(() => expect(useChat.getState().turn).toBeNull(), { timeout: 5000 });
    expect(screen.getByTestId(`chat.assistant-message:${mid}`)).toHaveAttribute('data-status', 'saved');
    expect(screen.getByTestId(`chat.evidence-chip:${mid}:E1`)).toHaveAttribute('data-state', 'supported');
    // 下一轮接在新回答后面
    act(() => useChat.getState().setDraft(K, { text: '再问' }));
    fireEvent.click(screen.getByTestId('composer.send'));
    await waitFor(() =>
      expect(seen.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(2),
    );
    const second = seen.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))[1];
    expect((second.body as { parent_id: string }).parent_id).toBe(mid);
  });
});
