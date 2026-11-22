// @vitest-environment node
// 有状态模拟后端：上传后 queued → parsing → 3 s 后 ready；重试解析；新建项目在顶部；对话分页；场景开关让位给 fixture。
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationPage, DocumentGroups, ProjectList, UploadResult } from '../api/endpoints';
import type { Document, Project } from '../api/types';
import type { RestFixture } from './fixture-types';
import { fixtures, handlers, resetMockScenarios, setMockScenario } from './handlers';
import { PARSE_MS, resetWorld, worldControls, worldHandlers } from './world';

const server = setupServer(...worldHandlers, ...handlers);
const B = 'http://localhost';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => resetWorld());
afterEach(() => {
  resetMockScenarios();
  vi.useRealTimers();
});
afterAll(() => server.close());

const getJson = async <T>(path: string) => (await (await fetch(B + path)).json()) as T;
const docOf = (g: DocumentGroups, id: string) =>
  g.groups.flatMap((x) => x.documents).find((d) => d.id === id) as Document;

describe('world：项目与对话', () => {
  it('初始项目列表与 fixture 一致', async () => {
    expect(await getJson<ProjectList>('/api/projects')).toEqual((fixtures['get-projects.ok.json'] as RestFixture).body);
  });

  it('新建项目去掉空格，插在列表顶部；名称不合法返回 VALIDATION_ERROR', async () => {
    const res = await fetch(`${B}/api/projects`, { method: 'POST', body: JSON.stringify({ name: '  强化学习 ' }) });
    const p = (await res.json()) as Project;
    expect(p).toMatchObject({ name: '强化学习', conversation_count: 0 });
    expect((await getJson<ProjectList>('/api/projects')).projects[0].id).toBe(p.id);
    const bad = await fetch(`${B}/api/projects`, { method: 'POST', body: JSON.stringify({ name: ' ' }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('对话分页：首页 limit=3 与 fixture 相同，cursor 取下一页，最后一页无 next_cursor', async () => {
    const p1 = await getJson<ConversationPage>('/api/projects/prj_dlintro/conversations?limit=3');
    expect(p1).toEqual((fixtures['get-projects-pid-conversations.ok.json'] as RestFixture).body);
    const p2 = await getJson<ConversationPage>(
      `/api/projects/prj_dlintro/conversations?cursor=${p1.next_cursor}&limit=20`,
    );
    expect(p2.conversations).toHaveLength(2);
    expect(p2.next_cursor).toBeUndefined();
  });

  it('指定场景时交回 fixture 层', async () => {
    setMockScenario('GET /api/projects', 'error');
    const res = await fetch(`${B}/api/projects`);
    expect(res.status).toBe((fixtures['get-projects.error.json'] as RestFixture).status);
  });
});

describe('world：上传与解析', () => {
  it(`上传 PDF：进入论文组，queued → parsing（带百分比）→ ${PARSE_MS} ms 后 ready`, async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const form = new FormData();
    form.append('file', new File([new Uint8Array(90_000)], 'Transformer-XL.pdf', { type: 'application/pdf' }));
    const up = (await (
      await fetch(`${B}/api/projects/prj_dlintro/documents`, { method: 'POST', body: form })
    ).json()) as UploadResult;
    const id = up.documents[0].id;
    expect(up.documents[0]).toMatchObject({ kind: 'pdf', group: 'paper', parse_status: 'queued', progress: 0 });
    let g = await getJson<DocumentGroups>('/api/projects/prj_dlintro/documents');
    expect(g.groups[0].documents.map((d) => d.id)).toContain(id);
    vi.advanceTimersByTime(1500);
    g = await getJson<DocumentGroups>('/api/projects/prj_dlintro/documents');
    expect(docOf(g, id)).toMatchObject({ parse_status: 'parsing' });
    expect(docOf(g, id).progress).toBeGreaterThanOrEqual(45);
    expect(docOf(g, id).progress).toBeLessThan(100);
    vi.advanceTimersByTime(PARSE_MS - 1500);
    g = await getJson<DocumentGroups>('/api/projects/prj_dlintro/documents');
    expect(docOf(g, id)).toMatchObject({ parse_status: 'ready', progress: 100, pages: 3 });
  });

  it('一次上传 3 个不同类型的文件，分别进各自分组', async () => {
    const form = new FormData();
    form.append('file', new File(['a\nb\nc'], 'util.py'));
    form.append('file', new File(['{"cells":[1,2]}'], 'nb.ipynb'));
    form.append('file', new File(['# t'], 'note.md'));
    const up = (await (
      await fetch(`${B}/api/projects/prj_dlintro/documents`, { method: 'POST', body: form })
    ).json()) as UploadResult;
    expect(up.documents.map((d) => d.group)).toEqual(['code', 'code', 'notes']);
    expect(up.job_ids).toHaveLength(3);
  });

  it('不支持的类型返回 VALIDATION_ERROR', async () => {
    const form = new FormData();
    form.append('file', new File(['x'], '作业3.docx'));
    const res = await fetch(`${B}/api/projects/prj_dlintro/documents`, { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('解析失败后重试：回到 queued，3 s 后 ready', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    worldControls.failDocument('doc_longmemeval', 'PDF 已加密，无法提取文字');
    let g = await getJson<DocumentGroups>('/api/projects/prj_dlintro/documents');
    expect(docOf(g, 'doc_longmemeval')).toMatchObject({
      parse_status: 'failed',
      parse_error: 'PDF 已加密，无法提取文字',
    });
    const res = await fetch(`${B}/api/documents/doc_longmemeval/reparse`, { method: 'POST' });
    expect(await res.json()).toHaveProperty('job_id');
    g = await getJson<DocumentGroups>('/api/projects/prj_dlintro/documents');
    expect(docOf(g, 'doc_longmemeval')).toMatchObject({ parse_status: 'queued' });
    expect(docOf(g, 'doc_longmemeval').parse_error).toBeUndefined();
    vi.advanceTimersByTime(PARSE_MS);
    g = await getJson<DocumentGroups>('/api/projects/prj_dlintro/documents');
    expect(docOf(g, 'doc_longmemeval')).toMatchObject({ parse_status: 'ready', pages: 31 });
  });

  it('新项目没有材料：groups 为空', async () => {
    const res = await fetch(`${B}/api/projects`, { method: 'POST', body: JSON.stringify({ name: '空项目' }) });
    const p = (await res.json()) as Project;
    expect(await getJson<DocumentGroups>(`/api/projects/${p.id}/documents`)).toEqual({ groups: [] });
  });
});
