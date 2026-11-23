// F5 单元测试：划词工具条（开分支追问 / 引用 / 复制）、分支标记、分支概览标签、合并卡片、分支面板（来源原句、上下文提示、要点合并）。
// 每份规格「状态」表一条以上的渲染测试；数据来自 docs/contract/fixtures（经 mocks/chat-world）。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch, ConversationTree } from '../api/types';
import { BranchMarkBadge, BranchMarkText } from '../chat/BranchMark';
import MergeCard from '../chat/MergeCard';
import ChatColumn from '../chat/ChatColumn';
import BranchOverview from '../chat/ChatHeader';
import { quoteBlock } from '../chat/SelectionToolbar';
import { sliceByCp, stripCitations } from '../lib/citations';
import { buildAnswerMarkup } from '../lib/answerMarkup';
import { markGroupsFor } from '../lib/branchMarkup';
import { plainToRange, rangeToPlain } from '../lib/selection';
import { PanelControlContext } from '../layout/panelControl';
import { leafGuardHandlers } from '../mocks/chat-world';
import { fixtures, setMockScenario } from '../mocks/handlers';
import RightPane from '../preview/RightPane';
import { draftKey, useChat } from '../store/chat';
import { useEvidence } from '../store/evidence';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';
import { renderWithClient, seen, server, setupF3Msw } from '../test/f3-utils';
import { CONTEXT_TIP } from './ContextHint';
import { MERGE_CONFIRM } from './MergeButton';
import { NEW_BRANCH_PLACEHOLDER } from './BranchPanel';
import { branchLeaf, branchPath, forkOrdinal } from './model';

setupF3Msw();
vi.setConfig({ testTimeout: 20000 });

const TREE = (fixtures['get-conversations-cid-tree.ok.json'] as { body: ConversationTree }).body;
const A1 = TREE.messages.find((m) => m.id === 'msg_tf_a1')!;
const PLAIN_A1 = stripCitations(A1.content);
const VARIANCE = TREE.branches.find((b) => b.id === 'br_variance')!;

beforeEach(() => {
  server.use(...leafGuardHandlers);
  Element.prototype.scrollIntoView = vi.fn();
  window.getSelection()?.removeAllRanges();
});

const openChat = () => {
  useChat.setState({ conversationId: 'cnv_transformer' });
  useLayout.setState({ view: 'conversation' });
  window.history.replaceState(null, '', '/c/cnv_transformer');
  return renderWithClient(
    <PanelControlContext.Provider value={{ effective: [false, false, false, false], toggle: () => {} }}>
      <ChatColumn />
      <RightPane />
    </PanelControlContext.Provider>,
  );
};
const loaded = () => screen.findByTestId('chat.assistant-message:msg_tf_a2', {}, { timeout: 5000 });
const body = (mid: string) => screen.getByTestId(`chat.answer-body:${mid}`);

/** 在某条回答正文里选中第一次出现的 text（按纯文本坐标换成 DOM Range），然后松开鼠标 */
function selectText(mid: string, content: string, text: string, from = 0) {
  const plain = stripCitations(content);
  const i = Array.from(plain).join('').indexOf(text, from);
  expect(i).toBeGreaterThanOrEqual(0);
  const start = Array.from(plain.slice(0, i)).length;
  const end = start + Array.from(text).length;
  const r = plainToRange(body(mid), content, start, end)!;
  expect(r).not.toBeNull();
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
  fireEvent.mouseUp(document);
  return { start, end };
}

const openBranch = (b: Pick<Branch, 'id' | 'title'>) =>
  act(() => useLayout.getState().openTab({ id: `branch:${b.id}`, kind: 'branch', ref_id: b.id, title: b.title }));

// ---------------------------------------------------------------- 坐标换算
describe('划词坐标（lib/selection、lib/branchMarkup）', () => {
  it('fixture 锚点与 quote 一致：去掉 [[E#]] 的纯文本按码点切片', () => {
    for (const b of TREE.branches) {
      const fork = TREE.messages.find((m) => m.id === b.fork_message_id)!;
      expect(sliceByCp(stripCitations(fork.content), b.anchor_start, b.anchor_end)).toBe(b.anchor_quote);
    }
  });

  it('DOM 选区 → 纯文本偏移：与契约坐标一致，胶囊文字不计入', async () => {
    openChat();
    await loaded();
    const root = body('msg_tf_a1');
    // 1) 锚点里的“方差是 dₖ”（码点坐标）
    const v = Array.from(PLAIN_A1.slice(0, PLAIN_A1.indexOf('方差是 dₖ'))).length;
    const r1 = plainToRange(root, A1.content, v, v + 6)!;
    expect(rangeToPlain(root, A1.content, r1)).toEqual({ start: v, end: v + 6, quote: '方差是 dₖ' });
    expect(v + 6).toBe(VARIANCE.anchor_end);
    // 两端空白会被去掉：“是 dₖ”前面的空格
    const sp = Array.from(PLAIN_A1.slice(0, PLAIN_A1.indexOf(' dₖ。dₖ = 64'))).length;
    expect(rangeToPlain(root, A1.content, plainToRange(root, A1.content, sp, sp + 3)!)?.quote).toBe('dₖ');
    // 2) 跨过证据胶囊“1 · p.4”：quote 里没有胶囊文字
    const a = Array.from(PLAIN_A1).join('').indexOf('方差是');
    const r2 = plainToRange(root, A1.content, a, a + 20)!;
    const got = rangeToPlain(root, A1.content, r2)!;
    expect(got.quote).toBe(sliceByCp(PLAIN_A1, a, a + 20));
    expect(got.quote).not.toMatch(/p\.4|1 · /);
    expect(r2.toString()).toMatch(/dₖ分支1。/); // DOM 里确实夹着分支小标与胶囊（jsdom 里胶囊未取到证据时只显示序号）
  });

  it('分支标记按组插入：同一句相交的分支合成一组', () => {
    const extra: Branch = {
      ...VARIANCE,
      id: 'br_x',
      anchor_start: 110,
      anchor_end: 120,
      created_at: '2026-11-22T07:00:00Z',
    };
    const groups = markGroupsFor('msg_tf_a1', A1.content, [...TREE.branches, extra]);
    expect(groups).toHaveLength(2);
    expect(groups[0].branches.map((b) => b.id)).toEqual(['br_variance', 'br_x']);
    expect(groups[0].end).toBe(120);
    // archived 不画
    expect(markGroupsFor('msg_tf_a1', A1.content, [{ ...VARIANCE, status: 'archived' }])).toHaveLength(0);
    // 占位：终点在胶囊之前
    const src = buildAnswerMarkup(A1.content, A1.citations ?? [], [{ start: 88, end: 117 }]).source;
    expect(src.indexOf('\uE000e0\uE001')).toBeLessThan(src.indexOf('\uE000c0\uE001'));
  });

  it('引用块格式', () => {
    expect(quoteBlock('方差是 dₖ')).toBe('> 方差是 dₖ\n\n');
    expect(quoteBlock('a\nb')).toBe('> a\n> b\n\n');
  });

  it('分支路径、叶子、fork 是第几条回答', () => {
    expect(branchPath(TREE, 'br_variance').map((m) => m.id)).toEqual([
      'msg_bv_u1',
      'msg_bv_a1',
      'msg_bv_u2',
      'msg_bv_a2',
    ]);
    expect(branchLeaf(TREE, VARIANCE)).toBe('msg_bv_a2');
    expect(
      branchLeaf({ ...TREE, messages: TREE.messages.filter((m) => m.branch_id !== 'br_variance') }, VARIANCE),
    ).toBe('msg_tf_a1');
    expect(forkOrdinal(TREE, VARIANCE)).toBe(1);
  });
});

// ---------------------------------------------------------------- 1-助手回答-分支标记
describe('1-助手回答-分支标记', () => {
  it('fixture 的两个分支：原句虚线下划线，句末“⑂ 分支”；点击右栏打开该分支', async () => {
    openChat();
    await loaded();
    const spans = document.querySelectorAll('[data-mn-branch-ids~="br_variance"]');
    expect(Array.from(spans, (s) => s.textContent).join('')).toBe(VARIANCE.anchor_quote);
    const badge = screen.getByTestId('chat.branch-mark:br_variance');
    expect(badge).toHaveTextContent('分支');
    expect(screen.getByTestId('chat.branch-mark:br_onehot')).toBeInTheDocument();
    fireEvent.click(badge);
    expect(useLayout.getState().activeTab).toBe('branch:br_variance');
    expect(await screen.findByTestId('right.branch-panel')).toHaveAttribute('data-bid', 'br_variance');
  });

  it('同一句多个分支：小标“⑂ 2”，点击弹出选择；merged 下划线改实线淡色', () => {
    const b2: Branch = { ...VARIANCE, id: 'br_two', title: '第二个', status: 'merged' };
    const group = { index: 0, start: 88, end: 117, branches: [VARIANCE, b2] };
    renderWithClient(
      <p>
        <BranchMarkText group={group}>方差</BranchMarkText>
        <BranchMarkBadge group={group} messageId="msg_tf_a1" />
      </p>,
    );
    const badge = screen.getByTestId('chat.branch-mark:br_variance');
    expect(badge).toHaveTextContent('2');
    expect(badge).toHaveAttribute('data-count', '2');
    fireEvent.click(badge);
    const menu = screen.getByTestId('chat.branch-mark.menu:br_variance');
    expect(within(menu).getByTestId('chat.branch-mark.option:br_two')).toHaveTextContent('已合并');
    expect(screen.getByTestId('chat.branch-mark.option:br_variance')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByTestId('chat.branch-mark.menu:br_variance')).toBeNull();
    expect(badge).toHaveFocus();
    fireEvent.click(badge);
    fireEvent.click(screen.getByTestId('chat.branch-mark.option:br_two'));
    expect(useLayout.getState().activeTab).toBe('branch:br_two');
    // 全部 merged 时实线淡色
    const merged = { ...group, branches: [b2] };
    const { container } = renderWithClient(<BranchMarkText group={merged}>x</BranchMarkText>);
    expect(container.querySelector('.mn-branch-text')).toHaveAttribute('data-merged', 'true');
  });
});

// ---------------------------------------------------------------- 1-对话栏-分支概览标签
describe('1-对话栏-分支概览标签', () => {
  const tree = (branches: Branch[]): ConversationTree => ({ ...TREE, branches });

  it('0 个分支：只显示“主线”，不可点', () => {
    renderWithClient(<BranchOverview tree={tree([])} />);
    const chip = screen.getByTestId('chat.branch-chip');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).toHaveTextContent(/^主线$/);
    expect(chip).toHaveAttribute('aria-disabled', 'true');
  });

  it('“主线 · N 个分支”（不计 archived）；列表：标题、原句前 20 字、merged/archived 灰色并标注', () => {
    const merged: Branch = { ...VARIANCE, id: 'br_m', title: '已合并的', status: 'merged' };
    const archived: Branch = { ...VARIANCE, id: 'br_a', title: '已归档的', status: 'archived' };
    renderWithClient(<BranchOverview tree={tree([...TREE.branches, merged, archived])} />);
    const chip = screen.getByTestId('chat.branch-chip');
    expect(chip).toHaveTextContent('主线 · 3 个分支');
    fireEvent.click(chip);
    // 标题 + 锚点原句前 20 字
    expect(screen.getByTestId('chat.branch-chip.item:br_variance')).toHaveTextContent(
      `方差为什么是 dₖ“${Array.from(VARIANCE.anchor_quote).slice(0, 20).join('')}…”`,
    );
    expect(screen.getByTestId('chat.branch-chip.item:br_m')).toHaveTextContent('已合并');
    expect(screen.getByTestId('chat.branch-chip.item:br_m')).toHaveClass('text-faint');
    expect(screen.getByTestId('chat.branch-chip.item:br_a')).toHaveTextContent('已归档');
    expect(screen.getByTestId('chat.branch-chip.item:br_variance')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('chat.branch-chip.menu'), { key: 'Escape' });
    expect(chip).toHaveFocus();
  });

  it('点列表中的分支：右栏打开该分支并把主线滚到锚点', async () => {
    openChat();
    await loaded();
    fireEvent.click(screen.getByTestId('chat.branch-chip'));
    fireEvent.click(screen.getByTestId('chat.branch-chip.item:br_onehot'));
    expect(useLayout.getState().activeTab).toBe('branch:br_onehot');
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        vi
          .mocked(Element.prototype.scrollIntoView)
          .mock.contexts.some((c) => ((c as Element).getAttribute('data-mn-branch-ids') ?? '').includes('br_onehot')),
      ).toBe(true),
    );
  });
});

// ---------------------------------------------------------------- 2-划词-划词工具条 及三个按钮
describe('2-划词-划词工具条', () => {
  it('选中回答里的文字：出现工具条，useUI.selection 是去标记纯文本的码点偏移', async () => {
    openChat();
    await loaded();
    const { start, end } = selectText('msg_tf_a1', A1.content, '方差是 dₖ');
    const bar = await screen.findByTestId('chat.selection-toolbar');
    expect(useUI.getState().selection).toMatchObject({ message_id: 'msg_tf_a1', start, end, quote: '方差是 dₖ' });
    expect(within(bar).getByTestId('chat.toolbar-branch')).toHaveTextContent('开分支追问');
    expect(within(bar).getByTestId('chat.toolbar-quote')).toHaveTextContent('引用');
    expect(within(bar).getByTestId('chat.toolbar-copy')).toHaveTextContent('复制');
    // Tab 进入工具条，→ 移动
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByTestId('chat.toolbar-branch')).toHaveFocus();
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(screen.getByTestId('chat.toolbar-quote')).toHaveFocus();
    // Esc 关闭
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('chat.selection-toolbar')).toBeNull());
  });

  it('选区 < 2 字、跨消息、在用户消息里：不出现', async () => {
    openChat();
    await loaded();
    selectText('msg_tf_a1', A1.content, '方');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('chat.selection-toolbar')).toBeNull();
    // 跨两条回答
    const r = document.createRange();
    r.setStart(body('msg_tf_a1').firstChild!, 0);
    r.setEnd(body('msg_tf_a2'), 1);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    fireEvent.mouseUp(document);
    await new Promise((res) => setTimeout(res, 20));
    expect(screen.queryByTestId('chat.selection-toolbar')).toBeNull();
    // 用户消息
    const u = screen.getByTestId('chat.user-message:msg_tf_u1');
    const r2 = document.createRange();
    r2.selectNodeContents(u);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r2);
    fireEvent.mouseUp(document);
    await new Promise((res) => setTimeout(res, 20));
    expect(useUI.getState().selection).toBeNull();
  });

  it('点别处、滚动：关闭', async () => {
    openChat();
    await loaded();
    selectText('msg_tf_a1', A1.content, '方差是 dₖ');
    await screen.findByTestId('chat.selection-toolbar');
    fireEvent.mouseDown(screen.getByTestId('chat.panel.title'));
    expect(useUI.getState().selection).toBeNull();
    selectText('msg_tf_a1', A1.content, '方差是 dₖ');
    await screen.findByTestId('chat.selection-toolbar');
    fireEvent.scroll(screen.getByTestId('chat.message-list'));
    expect(useUI.getState().selection).toBeNull();
  });
});

describe('2-划词工具条-开分支追问', () => {
  it('点击：POST /api/branches，右栏新开分支并聚焦输入框，原句出现分支标记，路由 /c/:cid/b/:bid', async () => {
    openChat();
    await loaded();
    const { start, end } = selectText('msg_tf_a1', A1.content, 'softmax 饱和时梯度同样几乎为 0');
    fireEvent.click(await screen.findByTestId('chat.toolbar-branch'));
    await waitFor(() => expect(useLayout.getState().activeTab).toBe('branch:br_saturation'));
    const post = seen.find((r) => r.method === 'POST' && r.path === '/api/branches');
    expect(post?.body).toEqual({
      conversation_id: 'cnv_transformer',
      fork_message_id: 'msg_tf_a1',
      anchor: { start, end, quote: 'softmax 饱和时梯度同样几乎为 0' },
    });
    expect(await screen.findByTestId('chat.branch-mark:br_saturation')).toBeInTheDocument();
    const panel = await screen.findByTestId('right.branch-panel');
    const ta = within(panel).getByRole('textbox');
    await waitFor(() => expect(ta).toHaveFocus());
    expect(ta).toHaveAttribute('placeholder', NEW_BRANCH_PLACEHOLDER);
    expect(useChat.getState().activeBranchId).toBe('br_saturation');
    expect(window.location.pathname).toBe('/c/cnv_transformer/b/br_saturation');
    expect(useUI.getState().selection).toBeNull();
  });

  it('失败：提示条，选区保留', async () => {
    setMockScenario('POST /api/branches', 'error');
    openChat();
    await loaded();
    selectText('msg_tf_a1', A1.content, '方差是 dₖ');
    fireEvent.click(await screen.findByTestId('chat.toolbar-branch'));
    await waitFor(() =>
      expect(useUI.getState().toasts.some((t) => t.kind === 'error' && /开分支失败/.test(t.text))).toBe(true),
    );
    expect(useUI.getState().selection?.quote).toBe('方差是 dₖ');
    expect(screen.getByTestId('chat.toolbar-branch')).toHaveAttribute('data-state', 'idle');
  });

  it('提交中按钮转圈', async () => {
    openChat();
    await loaded();
    selectText('msg_tf_a1', A1.content, '方差是 dₖ');
    fireEvent.click(await screen.findByTestId('chat.toolbar-branch'));
    expect(screen.getByTestId('chat.toolbar-branch')).toHaveAttribute('data-state', 'pending');
    await waitFor(() => expect(useLayout.getState().rightTabs.length).toBe(1));
  });
});

describe('2-划词工具条-引用 / 复制', () => {
  it('引用：主线输入框插入 `> quote` 并聚焦，不发请求', async () => {
    openChat();
    await loaded();
    selectText('msg_tf_a1', A1.content, '方差是 dₖ');
    const before = seen.length;
    fireEvent.click(await screen.findByTestId('chat.toolbar-quote'));
    expect(useChat.getState().composer[draftKey('cnv_transformer')].text).toBe('> 方差是 dₖ\n\n');
    expect(seen.slice(before).some((r) => r.method !== 'GET')).toBe(false);
    await waitFor(() => expect(screen.getAllByRole('textbox')[0]).toHaveFocus());
    expect(useLayout.getState().rightTabs).toHaveLength(0);
  });

  it('复制：剪贴板不含胶囊文字，提示“已复制”', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    openChat();
    await loaded();
    const a = PLAIN_A1.indexOf('方差是');
    // 跨过 E1 胶囊
    const s = Array.from(PLAIN_A1.slice(0, a)).length;
    const r = plainToRange(body('msg_tf_a1'), A1.content, s, s + 20)!;
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    fireEvent.mouseUp(document);
    fireEvent.click(await screen.findByTestId('chat.toolbar-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toBe(sliceByCp(PLAIN_A1, s, s + 20));
    expect(writeText.mock.calls[0][0]).not.toMatch(/p\.4/);
    expect(useUI.getState().toasts.some((t) => t.text === '已复制')).toBe(true);
  });
});

// ---------------------------------------------------------------- 2-开分支追问-分支面板 及三个子模块
describe('2-开分支追问-分支面板', () => {
  it('来源原句、分支消息、上下文提示、合并按钮；激活时 activeBranchId 与路由，切走恢复 null', async () => {
    openChat();
    await loaded();
    openBranch(VARIANCE);
    const panel = await screen.findByTestId('right.branch-panel');
    expect(panel).toHaveAttribute('data-state', 'open');
    expect(within(panel).getByTestId('right.branch-anchor')).toHaveTextContent('分支自主线 · 第 1 条回答');
    expect(within(panel).getByTestId('right.branch-anchor.quote')).toHaveTextContent(`“${VARIANCE.anchor_quote}”`);
    for (const id of ['msg_bv_u1', 'msg_bv_a1', 'msg_bv_u2', 'msg_bv_a2'])
      expect(within(panel).getAllByTestId(new RegExp(`(user-message|assistant-message):${id}$`))).toHaveLength(1);
    // 分支回答不显示来源列表与操作行（UI-05）
    expect(within(panel).queryByTestId('chat.regenerate.copy:msg_bv_a1')).toBeNull();
    expect(within(panel).getByTestId('right.branch-context')).toHaveTextContent('上下文：主线前 1 轮 + 本分支');
    expect(within(panel).getByTestId('right.branch-merge')).toBeInTheDocument();
    expect(within(panel).getByRole('textbox')).toHaveAttribute('placeholder', '在分支里继续追问');
    expect(useChat.getState().activeBranchId).toBe('br_variance');
    expect(window.location.pathname).toBe('/c/cnv_transformer/b/br_variance');
    // 分支内不出划词工具条（v1 不支持分支内再开分支）
    const r = document.createRange();
    r.selectNodeContents(within(panel).getByTestId('chat.answer-body:msg_bv_a1'));
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    fireEvent.mouseUp(document);
    await new Promise((res) => setTimeout(res, 20));
    expect(useUI.getState().selection).toBeNull();
    // 切到别的标签：恢复主线
    act(() =>
      useLayout.getState().openTab({ id: 'pdf:doc_attention', kind: 'pdf', ref_id: 'doc_attention', title: 'A' }),
    );
    await waitFor(() => expect(useChat.getState().activeBranchId).toBeNull());
    expect(window.location.pathname).toBe('/c/cnv_transformer');
  });

  it('分支内发送：请求体带 branch_id，parent 为分支最后一条', async () => {
    openChat();
    await loaded();
    openBranch(VARIANCE);
    const panel = await screen.findByTestId('right.branch-panel');
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: '再举个例子' } });
    fireEvent.click(within(panel).getByTestId('composer.send'));
    await waitFor(() => expect(seen.some((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toBe(true));
    const post = seen.find((r) => r.method === 'POST' && r.path.endsWith('/messages'))!;
    expect(post.body).toMatchObject({ branch_id: 'br_variance', parent_id: 'msg_bv_a2', content: '再举个例子' });
    // 回答出现在分支面板，不进主线
    await within(panel).findByTestId(/chat\.assistant-message:msg_m\d+_a/, {}, { timeout: 6000 });
    expect(within(screen.getByTestId('chat.message-list')).queryByText('再举个例子')).toBeNull();
  });

  it('分支里的证据：请求带 leaf_id（契约 v0.4），右栏新开预览标签、不替换分支标签', async () => {
    openChat();
    await loaded();
    openBranch(VARIANCE);
    const panel = await screen.findByTestId('right.branch-panel');
    const chip = await within(panel).findByTestId('chat.evidence-chip:msg_bv_a1:E1');
    await waitFor(() =>
      expect(seen.some((r) => r.path === '/api/evidence/evd_att_p4_fn4?leaf_id=msg_bv_a2')).toBe(true),
    );
    await waitFor(() => expect(chip).toHaveTextContent('p.4'));
    fireEvent.click(chip);
    expect(useEvidence.getState().selectedLeafId).toBe('msg_bv_a2');
    expect(useLayout.getState().rightTabs.map((t) => t.id)).toEqual(['branch:br_variance', 'pdf:doc_attention']);
    expect(useLayout.getState().activeTab).toBe('pdf:doc_attention');
    // 主线胶囊不带 leaf_id
    expect(seen.some((r) => r.path === '/api/evidence/evd_att_p4_fn4')).toBe(true);
  });

  it('不存在的 leaf_id：模拟层按契约返回 VALIDATION_ERROR', async () => {
    const res = await fetch('/api/evidence/evd_att_p4_fn4?leaf_id=msg_nope');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('archived：只读，顶部提示', async () => {
    await fetch('/api/branches/br_onehot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    openChat();
    await loaded();
    expect(screen.getByTestId('chat.branch-chip')).toHaveTextContent('主线 · 1 个分支');
    expect(screen.queryByTestId('chat.branch-mark:br_onehot')).toBeNull();
    openBranch({ id: 'br_onehot', title: 'one-hot 是什么意思' });
    const panel = await screen.findByTestId('right.branch-panel');
    expect(panel).toHaveAttribute('data-state', 'archived');
    expect(within(panel).getByTestId('right.branch-panel.archived')).toBeInTheDocument();
    expect(within(panel).getByRole('textbox')).toHaveAttribute('readonly');
    expect(within(panel).queryByTestId('right.branch-merge')).toBeNull();
  });
});

describe('2-分支面板-上下文提示', () => {
  it('N 与 Branch.context_turns 一致；悬停/聚焦说明', async () => {
    openChat();
    await loaded();
    openBranch(VARIANCE);
    const hint = await screen.findByTestId('right.branch-context');
    expect(hint).toHaveAttribute('data-turns', String(VARIANCE.context_turns));
    expect(hint).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('right.branch-context.tip')).toHaveTextContent(CONTEXT_TIP);
    expect(hint).toHaveAttribute('aria-describedby', screen.getByTestId('right.branch-context.tip').id);
  });
});

describe('2-分支面板-来源原句与回到原处', () => {
  it('回到原处：对话栏滚到原句并闪烁高亮', async () => {
    openChat();
    await loaded();
    openBranch(VARIANCE);
    fireEvent.click(await screen.findByTestId('right.branch-anchor.back'));
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        vi
          .mocked(Element.prototype.scrollIntoView)
          .mock.contexts.some((c) => ((c as Element).getAttribute('data-mn-branch-ids') ?? '').includes('br_variance')),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-mn-branch-ids~="br_variance"]')).toHaveAttribute('data-flash', 'true'),
    );
  });
});

describe('2-分支面板-要点合并按钮 / 1-消息列表-合并卡片', () => {
  it('新分支无消息：不显示合并按钮', async () => {
    openChat();
    await loaded();
    selectText('msg_tf_a1', A1.content, 'softmax 饱和时梯度同样几乎为 0');
    fireEvent.click(await screen.findByTestId('chat.toolbar-branch'));
    const panel = await screen.findByTestId('right.branch-panel');
    expect(within(panel).queryByTestId('right.branch-merge')).toBeNull();
  });

  it('确认后合并：合并中转圈；主线末尾出现合并卡片并滚到它；分支只读、标记改实线；卡片可展开、可打开分支', async () => {
    openChat();
    await loaded();
    openBranch(VARIANCE);
    const panel = await screen.findByTestId('right.branch-panel');
    fireEvent.click(within(panel).getByTestId('right.branch-merge'));
    const dialog = screen.getByTestId('right.branch-merge.dialog');
    expect(dialog).toHaveTextContent(MERGE_CONFIRM);
    expect(screen.getByTestId('right.branch-merge.confirm')).toHaveFocus();
    // 取消
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByTestId('right.branch-merge.dialog')).toBeNull();
    fireEvent.click(within(panel).getByTestId('right.branch-merge'));
    fireEvent.click(screen.getByTestId('right.branch-merge.confirm'));
    expect(within(panel).getByTestId('right.branch-merge')).toHaveAttribute('data-state', 'merging');
    const card = await screen.findByTestId('chat.merge-card:msg_tf_merge1', {}, { timeout: 4000 });
    expect(card).toHaveTextContent('来自分支：方差为什么是 dₖ');
    expect(card).toHaveTextContent('单项 qᵢkᵢ 方差为 1');
    await waitFor(() =>
      expect(
        vi
          .mocked(Element.prototype.scrollIntoView)
          .mock.contexts.some((c) => (c as Element).getAttribute('data-testid') === 'chat.merge-card:msg_tf_merge1'),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByTestId('right.branch-panel')).toHaveAttribute('data-state', 'merged'));
    expect(screen.getByTestId('right.branch-panel.merged')).toHaveTextContent('已合并到主线');
    expect(within(screen.getByTestId('right.branch-panel')).getByRole('textbox')).toHaveAttribute('readonly');
    expect(screen.queryByTestId('right.branch-merge')).toBeNull();
    expect(screen.getByTestId('chat.branch-mark:br_variance')).toHaveAttribute('data-merged', 'true');
    // 合并卡片：收起 → 展开显示分支全部消息（只读）
    expect(card).toHaveAttribute('data-state', 'closed');
    fireEvent.click(within(card).getByTestId('chat.merge-card.toggle:msg_tf_merge1'));
    expect(card).toHaveAttribute('data-state', 'open');
    expect(
      within(card)
        .getAllByTestId(/chat\.merge-card\.item:/)
        .map((x) => x.dataset.testid),
    ).toEqual([
      'chat.merge-card.item:msg_bv_u1',
      'chat.merge-card.item:msg_bv_a1',
      'chat.merge-card.item:msg_bv_u2',
      'chat.merge-card.item:msg_bv_a2',
    ]);
    // 要点里/全文里的胶囊照常可点
    expect(within(card).getByTestId('chat.evidence-chip:msg_bv_a1:E1')).not.toBeDisabled();
    // 打开分支
    act(() =>
      useLayout.getState().openTab({ id: 'pdf:doc_attention', kind: 'pdf', ref_id: 'doc_attention', title: 'A' }),
    );
    fireEvent.click(within(card).getByTestId('chat.merge-card.open:msg_tf_merge1'));
    expect(useLayout.getState().activeTab).toBe('branch:br_variance');
  });

  it('失败：提示条，可重试', async () => {
    setMockScenario('POST /api/branches/{bid}/merge', 'error');
    openChat();
    await loaded();
    openBranch(VARIANCE);
    fireEvent.click(await screen.findByTestId('right.branch-merge'));
    fireEvent.click(screen.getByTestId('right.branch-merge.confirm'));
    await waitFor(() => expect(useUI.getState().toasts.some((t) => /合并失败/.test(t.text))).toBe(true));
    const t = useUI.getState().toasts.find((x) => /合并失败/.test(x.text))!;
    expect(t.action?.label).toBe('重试');
    expect(screen.getByTestId('right.branch-merge')).toHaveAttribute('data-state', 'idle');
  });
});

describe('1-消息列表-合并卡片（单独渲染）', () => {
  it('收起时要点最多 3 行；找不到对应分支时只显示要点、没有展开与打开', () => {
    const note = {
      id: 'msg_n',
      conversation_id: 'cnv_transformer',
      role: 'merge_note' as const,
      content: '要点',
      created_at: '',
    };
    renderWithClient(<MergeCard message={note} tree={{ ...TREE, messages: [...TREE.messages, note] }} />);
    expect(screen.getByTestId('chat.merge-card:msg_n')).toHaveTextContent('来自分支：已合并的分支');
    expect(screen.getByTestId('chat.merge-card.summary:msg_n')).toHaveClass('line-clamp-3');
    expect(screen.queryByTestId('chat.merge-card.toggle:msg_n')).toBeNull();
    expect(screen.queryByTestId('chat.merge-card.open:msg_n')).toBeNull();
  });
});
