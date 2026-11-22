// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Document } from '../api/types';
import { badgeOf, metaOf, tabFor, tabKindOf } from './documents';
import { parseRoute, routePath } from './router';
import { relativeDay } from './time';
import { isAccepted, splitAccepted } from './upload';

describe('router', () => {
  it.each([
    ['/', { name: 'home' }],
    ['/c/cnv_1', { name: 'conversation', cid: 'cnv_1' }],
    ['/c/cnv_1/b/br_2', { name: 'conversation', cid: 'cnv_1', bid: 'br_2' }],
    ['/market/skills', { name: 'market', market: { tab: 'skills' } }],
    ['/market/plugin/arxiv', { name: 'market', market: { tab: 'plugins', detail: { type: 'plugin', id: 'arxiv' } } }],
    ['/market/skill/pdf', { name: 'market', market: { tab: 'skills', detail: { type: 'skill', id: 'pdf' } } }],
    ['/unknown', { name: 'home' }],
  ])('%s', (path, route) => {
    expect(parseRoute(path)).toEqual(route);
    if (path !== '/unknown') expect(routePath(parseRoute(path))).toBe(path);
  });
});

describe('relativeDay', () => {
  const now = new Date(2026, 10, 22, 15, 0);
  it('当天 HH:MM、昨天、N 天前、更早的日期', () => {
    expect(relativeDay(new Date(2026, 10, 22, 9, 5).toISOString(), now)).toBe('09:05');
    expect(relativeDay(new Date(2026, 10, 21, 23, 0).toISOString(), now)).toBe('昨天');
    expect(relativeDay(new Date(2026, 10, 19, 10, 0).toISOString(), now)).toBe('3 天前');
    expect(relativeDay(new Date(2026, 10, 1, 10, 0).toISOString(), now)).toBe('11 月 1 日');
  });
});

describe('documents', () => {
  const d = (x: Partial<Document>): Document => ({
    id: 'doc',
    project_id: 'p',
    kind: 'pdf',
    group: 'paper',
    title: 't',
    parse_status: 'ready',
    progress: 100,
    cited_count: 0,
    created_at: '',
    ...x,
  });
  it('类型色块', () => {
    expect(badgeOf(d({ kind: 'code', title: 'a.ts' })).label).toBe('TS');
    expect(badgeOf(d({ kind: 'md', title: 'a.txt' })).label).toBe('TXT');
    expect(badgeOf(d({ kind: 'pptx' }))).toEqual({ label: 'PPT', cls: 'bg-ft-pptx' });
  });
  it('元信息', () => {
    expect(metaOf(d({ parse_status: 'queued', progress: 0 }))).toBe('解析 0%');
    expect(metaOf(d({ pages: 12 }))).toBe('12 页');
    expect(metaOf(d({ kind: 'md', lines: 40 }))).toBe('40 行');
    expect(metaOf(d({ parse_status: 'failed' }))).toBe('');
  });
  it('右栏标签', () => {
    expect(tabKindOf({ kind: 'ipynb' })).toBe('code');
    expect(tabFor('pdf', 'doc_1', 'A')).toEqual({ id: 'pdf:doc_1', kind: 'pdf', ref_id: 'doc_1', title: 'A' });
  });
});

describe('upload', () => {
  it('按扩展名拦截', () => {
    expect(isAccepted({ name: 'A.PDF' })).toBe(true);
    expect(splitAccepted([{ name: 'a.docx' }, { name: 'b.ipynb' }])).toEqual({
      ok: [{ name: 'b.ipynb' }],
      rejected: [{ name: 'a.docx' }],
    });
  });
});
