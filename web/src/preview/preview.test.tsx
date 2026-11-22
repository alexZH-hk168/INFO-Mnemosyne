// F4 单元测试：06-右栏 各规格“状态”表的每个状态 + 纯函数（几何、证据顺序、引用说明）。
// PDF 的 canvas / pdf.js 渲染在 jsdom 里跑不了，真实渲染、跳页与 bbox 高亮在 e2e（tests/e2e/f4-preview.spec.ts）里测。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Citation, Evidence, Message } from '../api/types';
import { setMockScenario } from '../mocks/handlers';
import { setupF3Msw, renderWithClient as renderBase } from '../test/f3-utils';
import { PanelControlContext } from '../layout/panelControl';
import type { ReactElement } from 'react';
import { useChat } from '../store/chat';
import { useEvidence } from '../store/evidence';
import { MAX_TABS, useLayout, type Tab } from '../store/layout';
import { parseNotebook } from './code/NotebookView';
import { splitLines } from './code/CodeBlock';
import { answerEvidenceIds, describeAnswer, evidenceNumber } from './evidenceModel';
import { formatFetchedAt } from './WebSnapshotViewer';
import { neighbors } from './MessageViewer';
import {
  boxToCss,
  findInItems,
  isValidBbox,
  locateQuote,
  pdfRectToTopLeft,
  spanToPdfRect,
  tagPosition,
  unionRects,
} from './pdf/geometry';
import { clampZoom } from './PdfToolbar';
import { PluginCardBody, FOLD_AT } from './PluginResultCard';
import RightPane, { EMPTY_TEXT } from './RightPane';
import { evidenceBarText } from './useEvidenceContext';

setupF3Msw();

/** RightPane 里的收起按钮要 FourPane 的 PanelControl，单测里给一个空实现 */
const panel = { effective: [false, false, false, false] as [boolean, boolean, boolean, boolean], toggle: () => {} };
/** 把证据放进“刚生成完的回答”的本地证据池再选中（与胶囊点击流式回答证据的路径一致） */
function selectLocal(ev: Evidence, mid = 'msg_local') {
  useChat.setState({
    streaming: {
      message_id: mid,
      client_msg_id: 'c',
      last_seq: 0,
      steps: [],
      evidence: [ev],
      text: '',
      citations: [],
      status: 'saved',
    } as never,
  });
  act(() => useEvidence.getState().select(ev.id, mid));
}

beforeAll(() => {
  // jsdom 没有 scrollIntoView / scrollTo
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = (() => {}) as never;
});

const renderWithClient = (ui: ReactElement) =>
  renderBase(<PanelControlContext.Provider value={panel}>{ui}</PanelControlContext.Provider>);

const tab = (kind: Tab['kind'], ref: string, title = ref): Tab => ({ id: `${kind}:${ref}`, kind, ref_id: ref, title });

// ---------------------------------------------------------------- 纯函数

describe('pdf/geometry', () => {
  it('bbox 校验：4 个有限数、x0<x1、y0<y1、落在页面内（允许 1pt 误差）', () => {
    expect(isValidBbox([107.8, 700.3, 504.0, 724.0], 612, 792)).toBe(true);
    expect(isValidBbox(undefined, 612, 792)).toBe(false);
    expect(isValidBbox([1, 2, 3], 612, 792)).toBe(false);
    expect(isValidBbox([10, 10, 5, 20], 612, 792)).toBe(false);
    expect(isValidBbox([10, 10, 700, 20], 612, 792)).toBe(false); // 越界
    expect(isValidBbox([10, 10, 612.5, 20], 612, 792)).toBe(true);
    expect(isValidBbox([0, 0, Number.NaN, 1], 612, 792)).toBe(false);
  });

  it('pt × 缩放 = CSS 像素（原点左上）；标签贴在高亮框右缘外侧', () => {
    const r = boxToCss([100, 700, 500, 724], 0.5);
    expect(r).toEqual({ left: 50, top: 350, width: 200, height: 12 });
    expect(tagPosition(r)).toEqual({ left: 256, top: 350 });
    expect(unionRects([r, { left: 40, top: 360, width: 10, height: 10 }])).toEqual({
      left: 40,
      top: 350,
      width: 210,
      height: 20,
    });
    expect(unionRects([])).toBeNull();
  });

  it('PDF 用户空间（y 向上）→ 契约坐标（左上原点）', () => {
    expect(pdfRectToTopLeft([100, 60, 200, 80], [0, 0, 612, 792])).toEqual([100, 712, 200, 732]);
    expect(pdfRectToTopLeft([100, 60, 200, 80], [10, 0, 622, 792])).toEqual([90, 712, 190, 732]);
  });

  const items = [
    {
      str: '4To illustrate why the dot products get large, assume',
      transform: [1, 0, 0, 1, 120, 90],
      width: 300,
      height: 9,
    },
    {
      str: 'variables with mean 0 and variance 1. Then their dot product, q · k =',
      transform: [1, 0, 0, 1, 108, 79],
      width: 380,
      height: 9,
    },
    { str: 'qiki, has mean 0 and variance dk.', transform: [1, 0, 0, 1, 380, 79], width: 120, height: 9 },
  ];

  it('页内查找：忽略大小写与空白，可跨文本项', () => {
    expect(findInItems(items, 'DOT PRODUCTS')).toHaveLength(1);
    expect(findInItems(items, 'mean 0')).toHaveLength(2);
    expect(findInItems(items, '')).toEqual([]);
    const hit = findInItems(items, 'assumevariables')[0];
    expect(hit.map((s) => s.item)).toEqual([0, 1]);
  });

  it('bbox 不可用时按原文定位文字块：开头到结尾跨多个文本项', () => {
    const quote =
      'To illustrate why the dot products get large, assume that the components of q and k are independent random variables with mean 0 and variance 1. Then their dot product, q · k = Σ q_i k_i, has mean 0 and variance d_k.';
    const spans = locateQuote(items, quote)!;
    expect(spans[0]).toMatchObject({ item: 0, start: 1 });
    expect(spans[spans.length - 1].item).toBe(2);
    expect(locateQuote(items, '完全不在页面上的句子')).toBeNull();
    const rect = spanToPdfRect(items[0] as never, { item: 0, start: 0, end: items[0].str.length });
    expect(rect[0]).toBe(120);
    expect(rect[2]).toBe(420);
  });
});

describe('证据顺序与说明（evidenceModel）', () => {
  const cits: Citation[] = [
    { citation_id: 'c3', eid: 'e3', label: 'E3', sentence_start: 0, sentence_end: 1, verdict: 'removed' },
    { citation_id: 'c2', eid: 'e2', label: 'E2', sentence_start: 0, sentence_end: 1, verdict: 'partial' },
    { citation_id: 'c1', eid: 'e1', label: 'E1', sentence_start: 0, sentence_end: 1, verdict: 'supported' },
    { citation_id: 'c1b', eid: 'e1', label: 'E1', sentence_start: 2, sentence_end: 3, verdict: 'supported' },
  ];
  it('去掉 removed、同一证据只算一次、按序号排', () => {
    expect(answerEvidenceIds(cits)).toEqual(['e1', 'e2']);
    expect(evidenceNumber(cits, 'e2')).toBe('2');
    expect(evidenceNumber(cits, 'nope')).toBeNull();
  });

  const m = (id: string, role: 'user' | 'assistant', parent?: string, branch?: string): Message => ({
    id,
    conversation_id: 'c',
    role,
    content: '',
    created_at: '2026-11-22T00:00:00Z',
    ...(parent ? { parent_id: parent } : {}),
    ...(branch ? { branch_id: branch } : {}),
  });
  const msgs = [
    m('u1', 'user'),
    m('a1', 'assistant', 'u1'),
    m('u2', 'user', 'a1'),
    m('a2', 'assistant', 'u2'),
    m('bu1', 'user', 'a1', 'b1'),
    m('ba1', 'assistant', 'bu1', 'b1'),
  ];
  const branches = [{ id: 'b1', title: '方差为什么是 dₖ' }] as never;
  it('主线第 N 条 / 分支「标题」第 N 条 / 还没入树的回答按父消息推算', () => {
    expect(describeAnswer(msgs, branches, 'a1')).toBe('主线第 1 条回答');
    expect(describeAnswer(msgs, branches, 'a2')).toBe('主线第 2 条回答');
    expect(describeAnswer(msgs, branches, 'ba1')).toBe('分支「方差为什么是 dₖ」第 1 条回答');
    expect(describeAnswer(msgs, branches, 'new', { parent_id: 'a2' })).toBe('主线第 3 条回答');
    expect(describeAnswer(msgs, branches, 'missing')).toBeNull();
  });

  it('证据栏文字', () => {
    const ev = {
      id: 'x',
      source_type: 'material',
      source_id: 'd',
      title: 't',
      locator: { page: 4, sentence_ids: [], bbox: [0, 0, 1, 1] },
      quote: 'q',
    } as Evidence;
    expect(evidenceBarText(ev, '1', '主线第 1 条回答')).toBe('证据 1 · 第 4 页 · 被主线第 1 条回答引用');
    expect(evidenceBarText(ev, null, null)).toBe('证据 ? · 第 4 页');
  });
});

describe('其他纯函数', () => {
  it('缩放限制在 50%–200%', () => {
    expect(clampZoom(0.3)).toBe(0.5);
    expect(clampZoom(2.4)).toBe(2);
    expect(clampZoom(1.1000001)).toBe(1.1);
  });
  it('代码按行切分，末尾换行不算一行', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
  });
  it('Notebook 只留代码与 Markdown 单元，记下输出个数', () => {
    const nb = parseNotebook(
      JSON.stringify({
        cells: [
          { cell_type: 'markdown', source: ['# T\n', 'x'] },
          { cell_type: 'raw', source: 'skip' },
          { cell_type: 'code', source: 'print(1)', outputs: [{}, {}] },
        ],
      }),
    );
    expect(nb.cells.map((c) => [c.type, c.index, c.outputs])).toEqual([
      ['markdown', 0, 0],
      ['code', 2, 2],
    ]);
    expect(nb.cells[0].source).toBe('# T\nx');
  });
  it('历史对话退路：这条消息与前后各 1 条', () => {
    const base = { conversation_id: 'c', content: '', created_at: '2026-11-21T00:00:00Z' };
    const ms = [
      { ...base, id: 'a', role: 'user' },
      { ...base, id: 'b', role: 'assistant', parent_id: 'a' },
      { ...base, id: 'c', role: 'user', parent_id: 'b' },
      { ...base, id: 'd', role: 'assistant', parent_id: 'c' },
    ] as Message[];
    expect(neighbors(ms, 'b').map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(neighbors(ms, 'zz')).toEqual([]);
  });
  it('抓取时间格式', () => {
    expect(formatFetchedAt('not a date')).toBe('not a date');
    expect(formatFetchedAt('2026-11-22T06:21:04Z')).toMatch(/^2026-11-22 \d\d:\d\d$/);
  });
});

// ---------------------------------------------------------------- 外壳与标签条

describe('1-外壳-右栏 / 1-右栏-标签条', () => {
  it('无标签：空态文案', () => {
    renderWithClient(<RightPane />);
    expect(screen.getByTestId('right.panel.empty')).toHaveTextContent(EMPTY_TEXT);
    expect(screen.getByTestId('right.panel')).toHaveAttribute('data-kind', 'empty');
    expect(screen.getByTestId('right.tabs.more')).toBeDisabled();
  });

  it('点击切换、× 关闭后激活相邻、中键关闭；激活标签有 aria-selected', async () => {
    act(() => {
      useLayout.getState().openTab(tab('branch', 'br_variance', '方差为什么是 dₖ'));
      useLayout.getState().openTab(tab('web', 'ws_jalammar_illustrated', 'The Illustrated Transformer'));
      useLayout.getState().openTab(tab('code', 'doc_transformer_py', 'transformer.py'));
    });
    renderWithClient(<RightPane />);
    expect(screen.getByTestId('right.tabs.activate:code:doc_transformer_py')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('right.tabs.activate:branch:br_variance'));
    expect(useLayout.getState().activeTab).toBe('branch:br_variance');
    expect(screen.getByTestId('right.branch-placeholder')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('right.tabs.close:branch:br_variance'));
    expect(useLayout.getState().activeTab).toBe('web:ws_jalammar_illustrated');
    fireEvent(
      screen.getByTestId('right.tabs.tab:web:ws_jalammar_illustrated'),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    );
    expect(useLayout.getState().rightTabs.map((t) => t.id)).toEqual(['code:doc_transformer_py']);
    // 更多菜单
    fireEvent.click(screen.getByTestId('right.tabs.more'));
    expect(screen.getByTestId('right.tabs.menu-item:code:doc_transformer_py')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('right.tabs.menu'), { key: 'Escape' });
    expect(screen.queryByTestId('right.tabs.menu')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('right.code-preview')).toBeInTheDocument());
  });

  it('最多 8 个标签：超出时关闭最早未激活的非分支标签', () => {
    const { openTab, activateTab } = useLayout.getState();
    openTab(tab('branch', 'b1'));
    for (let i = 1; i <= MAX_TABS - 1; i++) openTab(tab('pdf', `d${i}`));
    activateTab('pdf:d1');
    openTab(tab('pdf', 'd9'));
    const ids = useLayout.getState().rightTabs.map((t) => t.id);
    expect(ids).toHaveLength(MAX_TABS);
    expect(ids).toContain('branch:b1');
    expect(ids).toContain('pdf:d1'); // 之前激活的保留
    expect(ids).not.toContain('pdf:d2'); // 最早未激活的非分支标签
    expect(useLayout.getState().activeTab).toBe('pdf:d9');
  });
});

// ---------------------------------------------------------------- 证据栏

describe('2-预览-证据栏', () => {
  const openHistory = async () => {
    useChat.setState({ conversationId: 'cnv_transformer' });
    act(() => {
      useLayout.getState().openTab(tab('web', 'ws_jalammar_illustrated', 'The Illustrated Transformer'));
    });
    renderWithClient(<RightPane />);
  };

  it('证据栏只在当前标签由证据打开时显示；文件栏直接打开不显示', async () => {
    await openHistory();
    await waitFor(() => expect(screen.getByTestId('right.web-preview')).toHaveAttribute('data-state', 'ready'));
    expect(screen.queryByTestId('right.evidence-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('right.web-preview.highlight')).not.toBeInTheDocument();
  });

  it('历史消息的证据：文字、来源色、‹ 1/2 ›；切到下一条换标签', async () => {
    useChat.setState({ conversationId: 'cnv_transformer' });
    const ev = {
      id: 'evd_att_p4_fn4',
      source_type: 'material',
      source_id: 'doc_attention',
      title: 'Attention Is All You Need',
      locator: { page: 4, sentence_ids: [], bbox: [107.8, 700.3, 504, 724] },
      quote: 'q',
    } as Evidence;
    act(() => useEvidence.getState().select('evd_att_p4_fn4', 'msg_tf_a1', { evidence: ev }));
    renderWithClient(<RightPane />);
    const bar = await screen.findByTestId('right.evidence-bar');
    await waitFor(() =>
      expect(within(bar).getByTestId('right.evidence-bar.text')).toHaveTextContent(
        '证据 1 · 第 4 页 · 被主线第 1 条回答引用',
      ),
    );
    expect(bar).toHaveAttribute('data-tone', 'material');
    expect(within(bar).getByTestId('right.evidence-bar.count')).toHaveTextContent('1 / 2');
    expect(useEvidence.getState().messageEvidence).toEqual(['evd_att_p4_fn4', 'evd_l05_s18']);
    fireEvent.click(within(bar).getByTestId('right.evidence-bar.next'));
    await waitFor(() => expect(useLayout.getState().activeTab).toBe('pptx:doc_l05_attention'));
    expect(useEvidence.getState().selectedEvidenceId).toBe('evd_l05_s18');
    await waitFor(() =>
      expect(screen.getByTestId('right.evidence-bar.text')).toHaveTextContent('证据 2 · 第 18 页幻灯片'),
    );
  });
});

// ---------------------------------------------------------------- 各预览的状态

describe('2-证据胶囊-PDF预览 / PPT预览（不跑 pdf.js 的状态）', () => {
  it('加载中显示页面骨架', () => {
    act(() => useLayout.getState().openTab(tab('pdf', 'doc_attention', 'Attention Is All You Need')));
    renderWithClient(<RightPane />);
    expect(screen.getByTestId('right.pdf-preview')).toHaveAttribute('data-state', 'loading');
    expect(screen.getByTestId('right.pdf-preview.loading')).toBeInTheDocument();
    expect(screen.getByTestId('right.pdf-toolbar.find')).toBeDisabled();
  });

  it('原文读不到：显示错误', async () => {
    act(() => useLayout.getState().openTab(tab('pdf', 'doc_missing', '缺失.pdf')));
    renderWithClient(<RightPane />);
    expect(await screen.findByTestId('right.pdf-preview.error')).toHaveTextContent('预览加载失败：材料不存在');
  });

  it('PPT 转换失败：“预览生成失败”', async () => {
    setMockScenario('GET /api/documents/{did}/raw', 'error');
    act(() => useLayout.getState().openTab(tab('pptx', 'doc_l05_attention', 'L05 注意力机制.pptx')));
    renderWithClient(<RightPane />);
    expect(await screen.findByTestId('right.slide-preview.error')).toHaveTextContent('预览生成失败');
  });
});

describe('2-文件行-代码预览', () => {
  it('有 locator：第 7 行整行高亮', async () => {
    const ev = {
      id: 'evd_tfpy_l7',
      source_type: 'material',
      source_id: 'doc_transformer_py',
      title: 'transformer.py',
      locator: { path: 'transformer.py', lines: [7, 7] },
      quote: 'scores',
    } as Evidence;
    selectLocal(ev);
    renderWithClient(<RightPane />);
    const line = await screen.findByTestId('right.code-preview.line:7');
    await waitFor(() => expect(line).toHaveAttribute('data-hl', 'true'));
    expect(line).toHaveTextContent('scores = q @ k.transpose(-2, -1) / math.sqrt(d_k)');
    expect(screen.getByTestId('right.code-preview.line:6')).not.toHaveAttribute('data-hl');
  });

  it('Notebook：14 个单元格，输出折叠', async () => {
    act(() => useLayout.getState().openTab(tab('code', 'doc_train_ipynb', 'train.ipynb')));
    renderWithClient(<RightPane />);
    await waitFor(() => expect(screen.getByTestId('right.code-preview')).toHaveAttribute('data-kind', 'ipynb'));
    await waitFor(() => expect(screen.getAllByTestId(/^right\.code-preview\.cell:\d+$/)).toHaveLength(14));
    expect(screen.getByTestId('right.code-preview.cell:5.outputs')).toHaveTextContent('已折叠 1 个输出');
  });

  it('Markdown：渲染为文档，按 lines 整块高亮', async () => {
    const ev = {
      id: 'e_md',
      source_type: 'material',
      source_id: 'doc_attention_notes',
      title: '注意力笔记.md',
      locator: { path: '注意力笔记.md', lines: [19, 19] },
      quote: 'softmax',
    } as Evidence;
    selectLocal(ev);
    renderWithClient(<RightPane />);
    const code = await screen.findByTestId('right.code-preview');
    await waitFor(() => expect(code.querySelector('h1')).toHaveTextContent('注意力笔记'));
    const hl = code.querySelector('[data-hl]');
    expect(hl?.tagName).toBe('BLOCKQUOTE');
    expect(hl).toHaveTextContent('softmax 饱和后输出接近 one-hot');
  });

  it('读不到原文：错误', async () => {
    act(() => useLayout.getState().openTab(tab('code', 'doc_missing', 'x.py')));
    renderWithClient(<RightPane />);
    expect(await screen.findByTestId('right.code-preview.error')).toHaveTextContent('材料不存在');
  });
});

describe('2-证据胶囊-网页快照预览', () => {
  it('有 char_range：高亮与 quote 一致；没有 iframe', async () => {
    const quote =
      'The third and fourth steps are to divide the scores by 8 (the square root of the dimension of the key vectors used in the paper – 64). This leads to having more stable gradients.';
    const ev = {
      id: 'evd_jalammar_scale',
      source_type: 'web',
      source_id: 'ws_jalammar_illustrated',
      title: 'The Illustrated Transformer',
      locator: { snapshot_id: 'ws_jalammar_illustrated', char_range: [210, 388] },
      quote,
    } as Evidence;
    selectLocal(ev);
    const { container } = renderWithClient(<RightPane />);
    expect(await screen.findByTestId('right.web-preview.highlight')).toHaveTextContent(quote);
    expect(screen.getByTestId('right.web-preview.url')).toHaveTextContent(
      'https://jalammar.github.io/illustrated-transformer/',
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('NOT_VISIBLE_ON_PATH：这个网页不在当前分支的可见范围内', async () => {
    act(() => useLayout.getState().openTab(tab('web', 'ws_sibling_branch', '兄弟分支网页')));
    renderWithClient(<RightPane />);
    expect(await screen.findByTestId('right.web-preview.error')).toHaveTextContent('这个网页不在当前分支的可见范围内');
  });
});

describe('2-证据胶囊-历史对话预览', () => {
  it('显示被引消息及前后各 1 条，高亮引用区间，不出现“记忆”', async () => {
    const ev = {
      id: 'evd_hw3_sigmoid',
      source_type: 'message',
      source_id: 'msg_hw3_a2',
      title: '反向传播 · 作业 3',
      locator: { message_id: 'msg_hw3_a2', char_range: [3, 40] },
      quote: 'x',
    } as Evidence;
    selectLocal(ev);
    renderWithClient(<RightPane />);
    expect(await screen.findByTestId('right.message-preview.message:msg_hw3_u3')).toBeInTheDocument();
    expect(screen.getByTestId('right.message-preview.source')).toHaveTextContent('来自对话：反向传播 · 作业 3');
    expect(screen.getByTestId('right.message-preview.highlight')).toHaveTextContent(
      'sigmoid 输入很大时导数 σ(x)(1−σ(x)) 趋近 0，梯度传不回去',
    );
    expect(screen.getByTestId('right.message-preview.open')).toBeInTheDocument();
    expect(screen.getByTestId('right.panel')).not.toHaveTextContent('记忆');
  });

  it('NOT_VISIBLE_ON_PATH：这段对话在其他分支中，当前不可见', async () => {
    const ev = {
      id: 'evd_sibling_branch',
      source_type: 'message',
      source_id: 'msg_sib',
      title: '兄弟分支',
      locator: { message_id: 'msg_sib', char_range: [0, 1] },
      quote: 'x',
    } as Evidence;
    selectLocal(ev);
    renderWithClient(<RightPane />);
    expect(await screen.findByTestId('right.message-preview.error')).toHaveTextContent(
      '这段对话在其他分支中，当前不可见',
    );
  });

  it('从“查看来源”打开（没有证据 id）：退回当前对话树里的消息', async () => {
    useChat.setState({ conversationId: 'cnv_transformer' });
    act(() => useLayout.getState().openTab(tab('message', 'msg_tf_a2', '历史对话')));
    renderWithClient(<RightPane />);
    expect(await screen.findByTestId('right.message-preview.message:msg_tf_a2')).toBeInTheDocument();
    expect(screen.getByTestId('right.message-preview.message:msg_tf_u2')).toBeInTheDocument();
    expect(screen.getByTestId('right.message-preview.source')).toHaveTextContent('Transformer 注意力精读');
  });
});

describe('2-证据胶囊-插件结果卡片', () => {
  it('字段与 locator.fields 一致；超长折叠可展开', () => {
    const long = 'x'.repeat(FOLD_AT + 30);
    const ev = {
      id: 'e_p',
      source_type: 'plugin',
      source_id: 'zotero',
      title: '插件结果',
      locator: {
        plugin_id: 'zotero',
        tool_name: 'search',
        fields: { title: 'Attention Is All You Need', year: 2017, abstract: long },
      },
      quote: '',
    } as Evidence;
    renderWithClient(<PluginCardBody evidence={ev} pluginName="Zotero MCP Plugin" />);
    expect(screen.getByTestId('right.plugin-card.plugin')).toHaveTextContent('Zotero MCP Plugin');
    expect(screen.getByTestId('right.plugin-card.tool')).toHaveTextContent('search');
    expect(screen.getByTestId('right.plugin-card.value:title')).toHaveTextContent('Attention Is All You Need');
    expect(screen.getByTestId('right.plugin-card.value:year')).toHaveTextContent('2017');
    expect(screen.getByTestId('right.plugin-card.value:abstract').textContent).toHaveLength(FOLD_AT + 1);
    fireEvent.click(screen.getByTestId('right.plugin-card.toggle:abstract'));
    expect(screen.getByTestId('right.plugin-card.value:abstract').textContent).toBe(long);
  });
});
