// [VER1] isTurnSettled：回合中途拍下的树里的空占位消息不能让进行中的一轮提前交给树。
import { describe, expect, it } from 'vitest';
import type { Streaming } from '../store/chat';
import { isTurnSettled } from './settle';

const base: Streaming = {
  message_id: 'msg_a',
  client_msg_id: 'c1',
  last_seq: 5,
  steps: [],
  evidence: [],
  text: '',
  citations: [],
  status: 'streaming',
};

describe('isTurnSettled', () => {
  it('树里没有这条消息：不交给树', () => {
    expect(isTurnSettled({ ...base, status: 'saved', text: '答' }, undefined)).toBe(false);
    expect(isTurnSettled(null, { content: '答' })).toBe(false);
  });

  it('流式还没结束：即使树里已有（空占位或已有正文）也不交给树', () => {
    expect(isTurnSettled({ ...base, status: 'streaming' }, { content: '' })).toBe(false);
    expect(isTurnSettled({ ...base, status: 'streaming', text: '部分' }, { content: '' })).toBe(false);
    expect(isTurnSettled({ ...base, status: 'verifying', text: '全文' }, { content: '全文' })).toBe(false);
  });

  it('流式已结束但树还是回合中途的空占位：等重新拉取', () => {
    expect(isTurnSettled({ ...base, status: 'saved', text: '全文' }, { content: '' })).toBe(false);
    expect(isTurnSettled({ ...base, status: 'error', text: '部分' }, { content: '' })).toBe(false);
  });

  it('流式已结束且树里是入库后的正文：交给树', () => {
    expect(isTurnSettled({ ...base, status: 'saved', text: '全文' }, { content: '全文（引用校验后）' })).toBe(true);
    expect(isTurnSettled({ ...base, status: 'cancelled', text: '' }, { content: '' })).toBe(true);
    expect(isTurnSettled({ ...base, status: 'error', text: '' }, { content: '' })).toBe(true);
  });
});
