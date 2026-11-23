// INT2：U113 三处界面问题的回归测试。
// ① 回答结束后证据写进查询缓存，下一轮（分支追问）清空流式证据池时，主线胶囊与来源列表不闪“…”占位；
// ② 分支默认标题：英文按单词边界截，中文仍前 12 字（与后端 auto_title 同一组用例）；
// ③ 从对话回到主页时关掉分支标签，主页无标签时右栏按 U40 收起；对话 A 切到对话 B 不关。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../api/queries';
import type { Citation, Evidence } from '../api/types';
import { defaultBranchTitle } from '../branch/model';
import { goConversation, goHome } from '../lib/nav';
import { useChat } from '../store/chat';
import { useEvidence } from '../store/evidence';
import { useLayout } from '../store/layout';
import { renderWithClient, setupF3Msw } from '../test/f3-utils';
import ChatColumn from './ChatColumn';
import { seedEvidenceCache } from './seedEvidence';
import SourceList from './SourceList';

setupF3Msw();
vi.setConfig({ testTimeout: 20000 });

const EV: Evidence = {
  id: 'evd_int2_p4',
  label: 'E1',
  source_type: 'material',
  source_id: 'doc_int2',
  title: 'Attention Is All You Need',
  locator: { page: 4, sentence_ids: ['s1'], bbox: [0, 0, 1, 1] },
  quote: 'To illustrate why the dot products get large',
};
const CIT: Citation = {
  citation_id: 'cit_int2',
  eid: EV.id,
  label: 'E1',
  sentence_start: 0,
  sentence_end: 5,
  verdict: 'supported',
};

describe('U113 ① 主线证据不闪占位', () => {
  const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const renderList = (qc: QueryClient) =>
    render(
      <QueryClientProvider client={qc}>
        <SourceList messageId="msg_int2_a" citations={[CIT]} />
      </QueryClientProvider>,
    );

  it('没写缓存时：流式证据池清空后来源卡先显示“…”（复现 INT1 截图 10 的现象）', () => {
    act(() => useChat.setState({ streaming: null }));
    renderList(client());
    expect(screen.getByTestId(`chat.source-list.item:${EV.id}`)).toHaveTextContent('1 · …');
  });

  it('写过缓存：流式证据池清空后同步显示标题与页码', () => {
    const qc = client();
    seedEvidenceCache(qc, [EV], null);
    act(() => useChat.setState({ streaming: null }));
    renderList(qc);
    const card = screen.getByTestId(`chat.source-list.item:${EV.id}`);
    expect(card).toHaveTextContent('Attention Is All You Need');
    expect(card.textContent).not.toContain('…');
  });

  it('不覆盖已有缓存；分支回答写带 leaf_id 的键', () => {
    const qc = client();
    const older = { ...EV, title: '已加载的版本' };
    qc.setQueryData(queryKeys.evidenceAt(EV.id, null), older);
    seedEvidenceCache(qc, [EV], null);
    expect(qc.getQueryData(queryKeys.evidenceAt(EV.id, null))).toBe(older);
    seedEvidenceCache(qc, [EV], 'msg_branch_a');
    expect(qc.getQueryData(queryKeys.evidenceAt(EV.id, 'msg_branch_a'))).toEqual(EV);
  });

  it('对话栏在回答结束（saved）时把流式证据写进缓存', async () => {
    useChat.setState({ conversationId: 'cnv_transformer' });
    useLayout.setState({ view: 'conversation' });
    const { client: qc } = renderWithClient(<ChatColumn />);
    await screen.findByTestId('chat.assistant-message:msg_tf_a2', {}, { timeout: 5000 });
    act(() =>
      useChat.setState({
        turn: {
          kind: 'send',
          conversation_id: 'cnv_transformer',
          client_msg_id: 'c1',
          content: '新问题',
          parent_id: 'msg_tf_a2',
          connection: 'live',
        },
        streaming: {
          message_id: 'msg_int2_a',
          client_msg_id: 'c1',
          last_seq: 9,
          steps: [],
          evidence: [EV],
          text: '答',
          citations: [CIT],
          status: 'saved',
        },
      }),
    );
    await waitFor(() => expect(qc.getQueryData(queryKeys.evidence(EV.id))).toEqual(EV));
  });
});

describe('U113 ② 分支默认标题', () => {
  it('英文不切在单词中间，中文仍前 12 字（与后端 test_auto_title_word_boundary 同一组）', () => {
    expect(defaultBranchTitle('The input consists of queries and keys')).toBe('The input');
    expect(defaultBranchTitle('  Scaled   dot-product attention  ')).toBe('Scaled');
    expect(defaultBranchTitle('softmax 饱和时梯度同样几乎为 0')).toBe('softmax 饱和时梯');
    expect(defaultBranchTitle('为什么要除以根号 dk 才能让方差稳定')).toBe('为什么要除以根号 dk');
    expect(defaultBranchTitle('Backpropagation through time')).toBe('Backpropagation');
    expect(defaultBranchTitle('multi-head attention')).toBe('multi-head');
    expect(defaultBranchTitle('Attention is all you need')).toBe('Attention is');
    expect(defaultBranchTitle('short one')).toBe('short one');
    expect(defaultBranchTitle('exactly 12ch')).toBe('exactly 12ch');
    expect(defaultBranchTitle('方差为什么是 dₖ 而不是 1 呢')).toBe('方差为什么是 dₖ 而不');
  });
});

describe('U113 ③ 回主页时关掉分支标签', () => {
  const branchTab = { id: 'branch:br_variance', kind: 'branch' as const, ref_id: 'br_variance', title: '方差' };
  const pdfTab = { id: 'pdf:doc_att', kind: 'pdf' as const, ref_id: 'doc_att', title: 'Attention' };

  it('从对话回主页：分支标签关闭、材料预览保留，上一段对话的证据选中清空', () => {
    act(() => goConversation('cnv_transformer'));
    act(() => useLayout.setState({ rightTabs: [pdfTab, branchTab], activeTab: branchTab.id }));
    act(() => useEvidence.setState({ selectedEvidenceId: 'evd_att_p4_fn4', selectedMessageId: 'msg_tf_a1' }));
    act(() => goHome());
    expect(useLayout.getState().rightTabs.map((t) => t.id)).toEqual([pdfTab.id]);
    expect(useLayout.getState().activeTab).toBe(pdfTab.id);
    expect(useEvidence.getState().selectedEvidenceId).toBeNull();
    expect(useEvidence.getState().selectedMessageId).toBeNull();
  });

  it('只有分支标签时回主页后右栏没有标签（FourPane 按 U40 运行时收起，见 e2e）', () => {
    act(() => goConversation('cnv_transformer'));
    act(() => useLayout.setState({ rightTabs: [branchTab], activeTab: branchTab.id }));
    act(() => goHome());
    expect(useLayout.getState().rightTabs).toEqual([]);
    expect(useLayout.getState().activeTab).toBeNull();
  });

  it('对话 A 切到对话 B 不关（F5：分支标签可以来自别的对话）', () => {
    act(() => goConversation('cnv_transformer'));
    act(() => useLayout.setState({ rightTabs: [branchTab], activeTab: branchTab.id }));
    act(() => goConversation('cnv_other'));
    expect(useLayout.getState().rightTabs.map((t) => t.id)).toEqual([branchTab.id]);
  });
});
