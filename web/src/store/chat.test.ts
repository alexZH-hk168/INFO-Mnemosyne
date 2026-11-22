import { beforeEach, describe, expect, it } from 'vitest';
import type { SseFixture } from '../mocks/fixture-types';
import full from '../../../docs/contract/fixtures/sse-turn-full.json';
import cancel from '../../../docs/contract/fixtures/sse-turn-cancel.json';
import failed from '../../../docs/contract/fixtures/sse-turn-error.json';
import { MAIN, useChat } from './chat';
import { useEvidence } from './evidence';
import { useUI } from './ui';

const turn = (x: unknown) => x as SseFixture;

beforeEach(() => useChat.setState({ projectId: null, conversationId: null, activeBranchId: null, streaming: null }));

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

  it('send 在 F0 尚未接 SSE 客户端，调用会明确报错', () => {
    expect(() => useChat.getState().send({ conversation_id: 'cnv_transformer' })).toThrow(/F3/);
  });
});

describe('useEvidence / useUI 骨架', () => {
  it('useEvidence 字段齐全，select 设置选中证据', () => {
    const s = useEvidence.getState();
    expect(s).toMatchObject({ selectedEvidenceId: null, messageEvidence: [], hover: null });
    s.select('evd_att_p4_fn4', 'msg_tf_a1');
    expect(useEvidence.getState().selectedEvidenceId).toBe('evd_att_p4_fn4');
  });

  it('useUI 字段齐全', () => {
    expect(useUI.getState()).toEqual({ modal: null, toasts: [], popover: null, selection: null });
  });
});
