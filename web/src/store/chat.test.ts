import { beforeEach, describe, expect, it } from 'vitest';
import type { SseFixture } from '../mocks/fixture-types';
import full from '../../../docs/contract/fixtures/sse-turn-full.json';
import cancel from '../../../docs/contract/fixtures/sse-turn-cancel.json';
import failed from '../../../docs/contract/fixtures/sse-turn-error.json';
import { MAIN, useChat } from './chat';
import { tabForEvidence, useEvidence } from './evidence';
import { DEFAULT_SIZES, useLayout } from './layout';
import { useUI } from './ui';

const turn = (x: unknown) => x as SseFixture;

beforeEach(() => {
  useChat.setState({ projectId: null, conversationId: null, activeBranchId: null, streaming: null });
  useLayout.setState({
    sizes: [...DEFAULT_SIZES],
    collapsed: [false, false, false, true],
    rightTabs: [],
    activeTab: null,
  });
  useEvidence.setState({ selectedEvidenceId: null, messageEvidence: [], hover: null });
  useUI.setState({ modal: null, toasts: [], popover: null, selection: null });
});

describe('useChat', () => {
  it('初始状态：主线草稿一份，没有进行中的回答', () => {
    const s = useChat.getState();
    expect(s.activeBranchId).toBeNull();
    expect(s.streaming).toBeNull();
    expect(s.composer[MAIN]).toEqual({ text: '', web_search: false, scope: { mode: 'all' }, attachments: [] });
  });

  it('applyEvent 回放完整回合：正文、步骤、证据、引用、状态都正确', () => {
    const fx = turn(full);
    for (const e of fx.events) useChat.getState().applyEvent(e);
    const s = useChat.getState().streaming!;
    const deltas = fx.events.flatMap((e) => (e.event === 'delta' ? [e.data.text] : []));
    expect(s.text).toBe(deltas.join(''));
    expect(s.steps).toHaveLength(3);
    expect(s.steps.every((x) => x.status === 'done')).toBe(true);
    expect(s.evidence.map((x) => x.label)).toEqual(['E1', 'E2', 'E3']);
    // eid → Evidence.id，source_id 来自事件（契约 v0.2）
    expect(s.evidence[0]).toMatchObject({ id: 'evd_att_p4_fn4', source_type: 'material', source_id: 'doc_attention' });
    expect(s.evidence[2]).toMatchObject({
      id: 'evd_jalammar_scale',
      source_type: 'web',
      source_id: 'ws_jalammar_illustrated',
    });
    expect(s.citations.map((c) => c.verdict)).toEqual(['supported', 'partial', 'removed']);
    expect(s.status).toBe('saved');
    expect(s.last_seq).toBe(fx.events.length);
  });

  it('citation 到达后、message.end 之前状态为 verifying', () => {
    const fx = turn(full);
    const firstCitation = fx.events.findIndex((e) => e.event === 'citation');
    for (const e of fx.events.slice(0, firstCitation + 1)) useChat.getState().applyEvent(e);
    expect(useChat.getState().streaming?.status).toBe('verifying');
  });

  it('续流时重复补发的事件被忽略', () => {
    const fx = turn(full);
    for (const e of fx.events.slice(0, 12)) useChat.getState().applyEvent(e);
    const textBefore = useChat.getState().streaming!.text;
    for (const e of fx.events.slice(8, 12)) useChat.getState().applyEvent(e);
    expect(useChat.getState().streaming!.text).toBe(textBefore);
  });

  it('取消回合以 cancelled 结束，失败回合以 error 结束', () => {
    for (const e of turn(cancel).events) useChat.getState().applyEvent(e);
    expect(useChat.getState().streaming?.status).toBe('cancelled');
    for (const e of turn(failed).events) useChat.getState().applyEvent(e);
    expect(useChat.getState().streaming?.status).toBe('error');
  });

  it('引用偏移按 Unicode 码点计数（契约 v0.2）：码点切片是整句，UTF-16 切片会错位', () => {
    for (const e of turn(full).events) useChat.getState().applyEvent(e);
    const s = useChat.getState().streaming!;
    const plain = s.text.replace(/\[\[E\d+\]\]/g, '');
    expect(plain.length).toBeGreaterThan(Array.from(plain).length); // 正文里有 BMP 以外的字符
    for (const c of s.citations) {
      const byCodePoint = Array.from(plain).slice(c.sentence_start, c.sentence_end).join('');
      expect(byCodePoint.endsWith('。')).toBe(true);
      expect(plain.slice(c.sentence_start, c.sentence_end).endsWith('。')).toBe(false);
    }
  });

  it('setProject / setConversation / setActiveBranch', () => {
    const s = useChat.getState();
    s.setProject('prj_dlintro');
    s.setConversation('cnv_transformer');
    s.setActiveBranch('br_variance');
    expect(useChat.getState()).toMatchObject({
      projectId: 'prj_dlintro',
      conversationId: 'cnv_transformer',
      activeBranchId: 'br_variance',
    });
    useChat.getState().setConversation('cnv_backprop_hw3');
    expect(useChat.getState()).toMatchObject({ conversationId: 'cnv_backprop_hw3', activeBranchId: null });
    useChat.getState().setConversation(null);
    expect(useChat.getState().conversationId).toBeNull();
  });

  it('send 在 F0 尚未接 SSE 客户端，调用会明确报错', () => {
    expect(() => useChat.getState().send({ conversation_id: 'cnv_transformer' })).toThrow(/F3/);
  });
});

describe('useEvidence / useUI 骨架', () => {
  it('useEvidence.select：设置选中、记下本回答的证据列表，并打开对应预览标签（右栏收起时展开）', () => {
    for (const e of turn(full).events) useChat.getState().applyEvent(e);
    useEvidence.getState().select('evd_att_p4_fn4', 'msg_tf_a1');
    expect(useEvidence.getState()).toMatchObject({
      selectedEvidenceId: 'evd_att_p4_fn4',
      messageEvidence: ['evd_att_p4_fn4', 'evd_l05_s18', 'evd_jalammar_scale'],
    });
    const layout = useLayout.getState();
    expect(layout.rightTabs).toEqual([
      { id: 'pdf:doc_attention', kind: 'pdf', ref_id: 'doc_attention', title: 'Attention Is All You Need' },
    ]);
    expect(layout.activeTab).toBe('pdf:doc_attention');
    expect(layout.collapsed[3]).toBe(false);
  });

  it('tabForEvidence：pptx / web / message 各自的标签', () => {
    for (const e of turn(full).events) useChat.getState().applyEvent(e);
    const [, l05, web] = useChat.getState().streaming!.evidence;
    expect(tabForEvidence(l05)).toMatchObject({ kind: 'pptx', ref_id: 'doc_l05_attention' });
    expect(tabForEvidence(web)).toMatchObject({ kind: 'web', ref_id: 'ws_jalammar_illustrated' });
    expect(
      tabForEvidence({
        id: 'evd_x',
        source_type: 'message',
        source_id: 'msg_hw3_a2',
        title: '反向传播 · 作业 3',
        locator: { message_id: 'msg_hw3_a2', char_range: [0, 5] },
        quote: 'x',
      }),
    ).toMatchObject({ kind: 'message', ref_id: 'msg_hw3_a2' });
  });

  it('useUI：openModal / closeModal / pushToast / dismissToast', () => {
    const ui = useUI.getState();
    expect(ui).toMatchObject({ modal: null, toasts: [], popover: null, selection: null });
    ui.openModal('card-intro', { card: 'paper' });
    expect(useUI.getState().modal).toEqual({ kind: 'card-intro', props: { card: 'paper' } });
    useUI.getState().openModal('settings');
    expect(useUI.getState().modal).toEqual({ kind: 'settings' });
    useUI.getState().closeModal();
    expect(useUI.getState().modal).toBeNull();
    const onClick = () => {};
    const a = useUI.getState().pushToast({ kind: 'info', text: '重连中' });
    const b = useUI.getState().pushToast({ kind: 'error', text: '重连失败', action: { label: '重新生成', onClick } });
    expect(a).not.toBe(b);
    expect(useUI.getState().toasts.map((t) => t.id)).toEqual([a, b]);
    useUI.getState().dismissToast(a);
    expect(useUI.getState().toasts).toEqual([
      { id: b, kind: 'error', text: '重连失败', action: { label: '重新生成', onClick } },
    ]);
  });
});
