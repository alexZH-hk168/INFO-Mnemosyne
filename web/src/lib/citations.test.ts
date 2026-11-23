// F3：引用标记与偏移换算、胶囊文字、步骤摘要。用例取自契约 fixture（第一句含 BMP 以外的 𝑑，码点比 UTF-16 少 1）。
import { describe, expect, it } from 'vitest';
import type { Citation, ConversationTree, Evidence, Step } from '../api/types';
import type { RestFixture, SseFixture } from '../mocks/fixture-types';
import { fixtures } from '../mocks/handlers';
import {
  cpLength,
  cpToUtf16,
  labelNumber,
  matchCitations,
  parseCitations,
  plainCpToRaw,
  rawToPlainCp,
  sliceByCp,
  stripCitations,
  trimPartialMarker,
  utf16ToCp,
} from './citations';
import { chipPosition, chipText, chipTone, longPosition, sourceKind } from './evidenceDisplay';
import { STEP_KIND_NAME, summarizeSteps } from './steps';
import { historyLatencyMs } from './latency';

const tree = (fixtures['get-conversations-cid-tree.ok.json'] as RestFixture).body as ConversationTree;
const a1 = tree.messages.find((m) => m.id === 'msg_tf_a1')!;
const full = fixtures['sse-turn-full.json'] as SseFixture;
const fullEvidence = full.events.flatMap((e) =>
  e.event === 'evidence'
    ? [
        {
          id: e.data.eid,
          label: e.data.label,
          source_type: e.data.source_type,
          source_id: e.data.source_id,
          title: e.data.title,
          locator: e.data.locator,
          quote: e.data.quote,
        } as Evidence,
      ]
    : [],
);

describe('码点与 UTF-16 换算', () => {
  it('BMP 以外的字符算 1 个码点', () => {
    expect('𝑑'.length).toBe(2);
    expect(cpLength('a𝑑b')).toBe(3);
    expect(cpToUtf16('a𝑑b', 2)).toBe(3);
    expect(utf16ToCp('a𝑑b', 3)).toBe(2);
    expect(sliceByCp('a𝑑bc', 1, 3)).toBe('𝑑b');
    expect(cpToUtf16('ab', 9)).toBe(2);
  });
});

describe('stripCitations / parseCitations', () => {
  it('去掉全部 [[E#]]，标记位置按码点计', () => {
    const { plain, markers } = parseCitations(a1.content);
    expect(plain).toBe(stripCitations(a1.content));
    expect(plain).not.toMatch(/\[\[E/);
    expect(markers.map((m) => [m.label, m.plainCp])).toEqual([
      ['E1', 117],
      ['E2', 242],
      ['E3', 288],
    ]);
    expect(cpLength(plain)).toBe(289);
  });

  it('fixture 的引用句按码点切片正好是整句', () => {
    const plain = stripCitations(a1.content);
    const c1 = a1.citations!.find((c) => c.label === 'E1')!;
    const s = sliceByCp(plain, c1.sentence_start, c1.sentence_end);
    expect(s.startsWith('论文的推理是')).toBe(true);
    expect(s.endsWith('方差是 dₖ。')).toBe(true);
    // 按 UTF-16 直接切会错一位（第一句里的 𝑑）
    expect(plain.slice(c1.sentence_start, c1.sentence_end)).not.toBe(s);
  });

  it('纯文本偏移 ↔ 原文下标', () => {
    const raw = a1.content;
    const c2 = a1.citations!.find((c) => c.label === 'E2')!;
    // 句末“。”之后、标记之后的位置
    const end = plainCpToRaw(raw, c2.sentence_end, 'after');
    expect(raw.slice(end - 7, end)).toBe('[[E2]]。');
    // 标记位置：before 在标记前，after 在标记后
    const mk = parseCitations(raw).markers[1];
    expect(plainCpToRaw(raw, mk.plainCp, 'before')).toBe(mk.rawStart);
    expect(plainCpToRaw(raw, mk.plainCp, 'after')).toBe(mk.rawEnd);
    expect(rawToPlainCp(raw, mk.rawEnd)).toBe(mk.plainCp);
    expect(rawToPlainCp(raw, mk.rawStart + 2)).toBe(mk.plainCp);
    expect(rawToPlainCp(raw, raw.length)).toBe(289);
    expect(plainCpToRaw(raw, 9999)).toBe(raw.length);
  });

  it('流式末尾的半个标记先不显示', () => {
    expect(trimPartialMarker('方差是 dₖ[[E')).toBe('方差是 dₖ');
    expect(trimPartialMarker('方差是 dₖ[[E1]')).toBe('方差是 dₖ');
    expect(trimPartialMarker('方差是 dₖ[')).toBe('方差是 dₖ');
    expect(trimPartialMarker('方差是 dₖ[[E1]]')).toBe('方差是 dₖ[[E1]]');
    expect(labelNumber('E12')).toBe('12');
  });

  it('标记与引用配对：按 label 与句子区间', () => {
    const { markers } = parseCitations(a1.content);
    const pairs = matchCitations(markers, a1.citations!);
    expect(pairs.map((c) => c?.verdict)).toEqual(['supported', 'partial', 'removed']);
    // 同一 label 出现两次时按区间分别配对
    const raw = '第一句[[E1]]。第二句[[E1]]。';
    const cits: Citation[] = [
      { citation_id: 'c2', eid: 'e', label: 'E1', sentence_start: 4, sentence_end: 8, verdict: 'partial' },
      { citation_id: 'c1', eid: 'e', label: 'E1', sentence_start: 0, sentence_end: 4, verdict: 'supported' },
    ];
    expect(matchCitations(parseCitations(raw).markers, cits).map((c) => c?.citation_id)).toEqual(['c1', 'c2']);
    expect(matchCitations(parseCitations('x[[E9]]').markers, cits)).toEqual([undefined]);
  });
});

describe('胶囊文字与配色', () => {
  it('按来源类型给位置简写', () => {
    const [pdf, pptx, web] = fullEvidence;
    expect(chipText('1', pdf)).toBe('1 · p.4');
    expect(chipText('2', pptx)).toBe('2 · p.18');
    expect(chipText('3', web)).toBe('3 · 网页');
    expect(chipText('4')).toBe('4');
    expect(chipPosition({ source_type: 'material', title: 'x.py', locator: { path: 'x.py', lines: [7, 9] } })).toBe(
      'L7',
    );
    expect(
      chipPosition({
        source_type: 'message',
        title: '反向传播 · 作业 3',
        locator: { message_id: 'm', char_range: [0, 1] },
      }),
    ).toBe('反向传播');
    expect(longPosition(pdf)).toBe('第 4 页');
    expect(longPosition({ source_type: 'material', title: 'x', locator: { path: 'x', lines: [3, 5], cell: 0 } })).toBe(
      '单元格 1 · 第 3–5 行',
    );
    expect(chipTone('plugin')).toBe('web');
    expect(chipTone('message')).toBe('message');
    expect(sourceKind(pptx)).toBe('pptx');
  });
});

describe('步骤摘要', () => {
  const steps = a1.steps as Step[];
  it('与 UI-05 文案格式一致；秒数是整轮耗时（message.end.latency_ms，U35）', () => {
    const end = full.events.find((e) => e.event === 'message.end');
    const latency = end && end.event === 'message.end' ? end.data.latency_ms : -1;
    expect(latency).toBe(9120);
    const s = summarizeSteps(steps, fullEvidence, latency);
    // INT2（U110）：sse-turn-full 有 recall_memory 步骤但事件流里没有 message 类证据，按实际证据数为 0（原期望“参考 1 段”按步骤数计）
    expect(s.text).toBe('检索 2 份材料、1 个网页，没有找到相关的历史对话');
    expect(s.count).toBe(3);
    expect(s.seconds).toBe(9);
    expect(s.failed).toBe(0);
    expect(s.running).toBeNull();
    // 不知道整轮耗时：不显示秒数（不再退回各步 duration_ms 之和）
    expect(summarizeSteps(steps, fullEvidence).seconds).toBe(0);
  });
  it('历史消息的整轮耗时：回答 created_at − 用户消息 created_at；重新生成的兄弟不推算', () => {
    const byId = new Map(tree.messages.map((m) => [m.id, m]));
    expect(historyLatencyMs(a1, byId, ['msg_tf_a1'])).toBe(9000);
    expect(historyLatencyMs(a1, byId, [])).toBe(9000);
    expect(historyLatencyMs(a1, byId, ['msg_other', 'msg_tf_a1'])).toBeUndefined();
    const u1 = byId.get('msg_tf_u1')!;
    expect(historyLatencyMs(u1, byId, [])).toBeUndefined();
    expect(historyLatencyMs({ ...a1, created_at: '2026-11-22T06:19:00Z' }, byId, [])).toBeUndefined();
  });
  it('没有证据时网页按步骤数', () => {
    // INT2（U110）：证据池为空时历史对话按 0 条计（原期望按步骤数“参考 1 段”）
    expect(summarizeSteps(steps).text).toBe('检索 1 个网页，没有找到相关的历史对话');
    expect(summarizeSteps([steps[0]]).text).toBe('检索项目材料');
  });
  it('进行中与失败', () => {
    const run: Step[] = [{ step_id: 'a', kind: 'search_materials', label: '检索项目材料', status: 'running' }];
    expect(summarizeSteps(run).running?.label).toBe('检索项目材料');
    const err: Step[] = [{ step_id: 'b', kind: 'fetch_url', label: '抓取网页', status: 'error', duration_ms: 500 }];
    const s = summarizeSteps(err);
    expect(s.failed).toBe(1);
    expect(s.text).toBe('抓取网页');
  });
  it('U110：历史对话按实际证据去重计数；0 条写“没有找到相关的历史对话”；只有被引用证据时不据此断定没找到', () => {
    const recall: Step[] = [{ step_id: 'r', kind: 'recall_memory', label: '参考 2 段历史对话', status: 'done' }];
    const msgEv = (source_id: string) => ({ source_type: 'message' as const, source_id });
    expect(summarizeSteps(recall, [msgEv('m1'), msgEv('m1'), msgEv('m2')]).text).toBe('参考 2 段历史对话');
    expect(summarizeSteps(recall, []).text).toBe('没有找到相关的历史对话');
    // 历史消息（evidenceComplete=false）：只读到被引用的证据，0 条时看步骤 label
    expect(summarizeSteps(recall, [], undefined, false).text).toBe('参考历史对话');
    expect(summarizeSteps(recall, [msgEv('m1')], undefined, false).text).toBe('参考 1 段历史对话');
    const none: Step[] = [{ step_id: 'r', kind: 'recall_memory', label: '没有找到相关的历史对话', status: 'done' }];
    expect(summarizeSteps(none, [], undefined, false).text).toBe('没有找到相关的历史对话');
    // 没有历史对话步骤：不出现这一段
    expect(summarizeSteps([steps[0]], fullEvidence).text).not.toContain('历史对话');
  });
  it('任何文案都不出现“记忆”', () => {
    expect(Object.values(STEP_KIND_NAME).join('')).not.toContain('记忆');
    expect(summarizeSteps(steps, fullEvidence).text).not.toContain('记忆');
  });
});
