// 有状态的模拟后端（F1）：让 MSW 能演示“新建项目出现在顶部”“对话列表翻页”“上传后解析 3 s 变 ready”“重试解析”。
// 初始数据全部取自 docs/contract/fixtures；fixture 没有的少量演示数据（第二页对话）放在本文件，遵守 R4。
// 规则：
//   - 只接管下面几个接口；其余接口仍由 handlers.ts 按 fixture 应答。
//   - 某接口用 setMockScenario 指定了场景时，本层不处理，交回 handlers.ts（F0 的场景开关继续有效）。
//   - 状态只在内存里，刷新页面即恢复初始数据。
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { ConversationPage, DocumentGroups, ProjectList } from '../api/endpoints';
import type { ConversationSummary, DocGroup, DocKind, Document, ID, Project } from '../api/types';
import type { RestFixture } from './fixture-types';
import { fixtures, getMockScenario } from './handlers';

/** 上传或重试后多久变为 ready（F1 提示词验收：3 s） */
export const PARSE_MS = 3000;
/** 进入 parsing 之前停留在 queued 的时间 */
const QUEUED_MS = 300;
const GROUP_ORDER: DocGroup[] = ['paper', 'slides', 'code', 'notes', 'web'];

/** fixture 只给了“深度学习导论”第一页 3 条（next_cursor=cur_3）；第二页的 2 条为本层补的演示数据 */
const EXTRA_CONVERSATIONS: Record<ID, ConversationSummary[]> = {
  prj_dlintro: [
    { id: 'cnv_softmax_stability', title: 'Softmax 数值稳定性', updated_at: '2026-11-12T09:00:00Z', branch_count: 0 },
    { id: 'cnv_layernorm', title: 'LayerNorm 与 BatchNorm 对比', updated_at: '2026-11-05T14:20:00Z', branch_count: 1 },
  ],
};

interface DocEntry {
  doc: Document;
  /** 有值表示正在模拟解析：performance.now() 时刻 */
  startedAt?: number;
  /** 解析结束时变为 failed 的原因 */
  failWith?: string;
  /** ready 后补上的元信息 */
  readyMeta?: Pick<Document, 'pages' | 'lines' | 'cells'>;
}

interface World {
  projects: Project[];
  conversations: Map<ID, ConversationSummary[]>;
  docs: Map<ID, DocEntry[]>;
  seq: number;
}

const body = <T>(file: string) => (fixtures[file] as RestFixture).body as T;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function initialWorld(): World {
  const projects = structuredClone(body<ProjectList>('get-projects.ok.json').projects);
  const convFx = fixtures['get-projects-pid-conversations.ok.json'] as RestFixture;
  const convPid = convFx.request?.params?.pid ?? 'prj_dlintro';
  const conversations = new Map<ID, ConversationSummary[]>();
  conversations.set(convPid, [
    ...structuredClone((convFx.body as ConversationPage).conversations),
    ...structuredClone(EXTRA_CONVERSATIONS[convPid] ?? []),
  ]);
  const docFx = fixtures['get-projects-pid-documents.ok.json'] as RestFixture;
  const docPid = docFx.request?.params?.pid ?? 'prj_dlintro';
  const docs = new Map<ID, DocEntry[]>();
  docs.set(
    docPid,
    (docFx.body as DocumentGroups).groups.flatMap((g) => g.documents.map((d) => ({ doc: structuredClone(d) }))),
  );
  return { projects, conversations, docs, seq: 0 };
}

let world = initialWorld();

/** 测试与调试：恢复初始数据 */
export function resetWorld(): void {
  world = initialWorld();
}

function currentDoc(e: DocEntry): Document {
  if (e.startedAt === undefined) return e.doc;
  const elapsed = now() - e.startedAt;
  if (elapsed < QUEUED_MS) return { ...e.doc, parse_status: 'queued', progress: 0 };
  if (elapsed < PARSE_MS) {
    const progress = Math.min(99, Math.max(1, Math.floor((elapsed / PARSE_MS) * 100)));
    return { ...e.doc, parse_status: 'parsing', progress };
  }
  // 解析结束：定格结果
  if (e.failWith) {
    const { parse_error: _old, ...rest } = e.doc;
    e.doc = { ...rest, parse_status: 'failed', progress: 0, parse_error: e.failWith };
  } else {
    const { parse_error: _old, ...rest } = e.doc;
    e.doc = { ...rest, ...e.readyMeta, parse_status: 'ready', progress: 100 };
  }
  e.startedAt = undefined;
  e.failWith = undefined;
  return e.doc;
}

function groupsOf(pid: ID): DocumentGroups {
  const all = (world.docs.get(pid) ?? []).map(currentDoc);
  return {
    groups: GROUP_ORDER.map((group) => ({ group, documents: all.filter((d) => d.group === group) })).filter(
      (g) => g.documents.length > 0,
    ),
  };
}

function findDoc(did: ID): DocEntry | undefined {
  for (const list of world.docs.values()) {
    const hit = list.find((e) => e.doc.id === did);
    if (hit) return hit;
  }
  return undefined;
}

const err = (status: number, code: string, message: string, retriable = false) =>
  HttpResponse.json({ error: { code, message, retriable } }, { status });

function kindOf(name: string): { kind: DocKind; group: DocGroup } | null {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.pdf':
      return { kind: 'pdf', group: 'paper' };
    case '.pptx':
      return { kind: 'pptx', group: 'slides' };
    case '.py':
    case '.js':
    case '.ts':
      return { kind: 'code', group: 'code' };
    case '.ipynb':
      return { kind: 'ipynb', group: 'code' };
    case '.md':
    case '.txt':
      return { kind: 'md', group: 'notes' };
    default:
      return null;
  }
}

async function metaFor(kind: DocKind, file: File): Promise<DocEntry['readyMeta']> {
  if (kind === 'pdf' || kind === 'pptx') return { pages: Math.max(1, Math.ceil(file.size / 40_000)) };
  const text = await file.text().catch(() => '');
  if (kind === 'ipynb') {
    try {
      const nb = JSON.parse(text) as { cells?: unknown[] };
      return { cells: Array.isArray(nb.cells) ? nb.cells.length : 1 };
    } catch {
      return { cells: 1 };
    }
  }
  return { lines: Math.max(1, text.split('\n').length) };
}

/** 本层接管的接口：指定了场景就交回 fixture 层（返回 undefined 让 MSW 继续匹配下一个 handler） */
const deferred = (endpoint: string) => getMockScenario(endpoint) !== undefined;

export const worldHandlers: HttpHandler[] = [
  http.get('*/api/projects', () => {
    if (deferred('GET /api/projects')) return undefined;
    return HttpResponse.json({ projects: world.projects } satisfies ProjectList);
  }),

  http.post('*/api/projects', async ({ request }) => {
    if (deferred('POST /api/projects')) return undefined;
    const input = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if ([...name].length < 1 || [...name].length > 60) return err(400, 'VALIDATION_ERROR', '项目名需为 1–60 个字');
    world.seq += 1;
    const project: Project = { id: `prj_new${world.seq}`, name, created_at: iso(), conversation_count: 0 };
    world.projects = [project, ...world.projects]; // 最近更新的在最前
    world.conversations.set(project.id, []);
    world.docs.set(project.id, []);
    return HttpResponse.json(project);
  }),

  http.get('*/api/projects/:pid/conversations', ({ params, request }) => {
    if (deferred('GET /api/projects/{pid}/conversations')) return undefined;
    const pid = String(params.pid);
    if (!world.projects.some((p) => p.id === pid)) return err(404, 'NOT_FOUND', '项目不存在');
    const url = new URL(request.url);
    const limit = Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20);
    const cursor = url.searchParams.get('cursor');
    const offset = cursor?.startsWith('cur_') ? Number(cursor.slice(4)) || 0 : 0;
    const all = world.conversations.get(pid) ?? [];
    const page: ConversationPage = { conversations: all.slice(offset, offset + limit) };
    if (offset + limit < all.length) page.next_cursor = `cur_${offset + limit}`;
    return HttpResponse.json(page);
  }),

  http.get('*/api/projects/:pid/documents', ({ params }) => {
    if (deferred('GET /api/projects/{pid}/documents')) return undefined;
    const pid = String(params.pid);
    if (!world.projects.some((p) => p.id === pid)) return err(404, 'NOT_FOUND', '项目不存在');
    return HttpResponse.json(groupsOf(pid));
  }),

  http.post('*/api/projects/:pid/documents', async ({ params, request }) => {
    if (deferred('POST /api/projects/{pid}/documents')) return undefined;
    const pid = String(params.pid);
    if (!world.projects.some((p) => p.id === pid)) return err(404, 'NOT_FOUND', '项目不存在');
    const form = await request.formData();
    const files = form.getAll('file').filter((f): f is File => typeof f !== 'string');
    if (files.length === 0) return err(400, 'VALIDATION_ERROR', '没有收到文件');
    const bad = files.find((f) => !kindOf(f.name));
    if (bad) return err(400, 'VALIDATION_ERROR', `暂不支持 ${bad.name}，请上传 PDF、PPTX、代码、Notebook 或 Markdown`);
    const list = world.docs.get(pid) ?? [];
    const created: Document[] = [];
    const jobIds: string[] = [];
    for (const f of files) {
      const k = kindOf(f.name)!;
      world.seq += 1;
      const doc: Document = {
        id: `doc_up${world.seq}`,
        project_id: pid,
        kind: k.kind,
        group: k.group,
        title: f.name,
        parse_status: 'queued',
        progress: 0,
        cited_count: 0,
        created_at: iso(),
      };
      list.push({ doc, startedAt: now(), readyMeta: await metaFor(k.kind, f) });
      created.push(doc);
      jobIds.push(`job_up${world.seq}`);
    }
    world.docs.set(pid, list);
    return HttpResponse.json({ documents: created, job_ids: jobIds });
  }),

  http.get('*/api/documents/:did', ({ params }) => {
    if (deferred('GET /api/documents/{did}')) return undefined;
    const e = findDoc(String(params.did));
    return e ? HttpResponse.json(currentDoc(e)) : undefined; // 不认识的 id 交回 fixture 层
  }),

  http.post('*/api/documents/:did/reparse', ({ params }) => {
    if (deferred('POST /api/documents/{did}/reparse')) return undefined;
    const e = findDoc(String(params.did));
    if (!e) return err(404, 'NOT_FOUND', '材料不存在');
    world.seq += 1;
    const { parse_error: _old, ...rest } = e.doc;
    e.doc = { ...rest, parse_status: 'queued', progress: 0 };
    e.readyMeta = e.readyMeta ?? { pages: e.doc.pages, lines: e.doc.lines, cells: e.doc.cells };
    e.startedAt = now();
    e.failWith = undefined;
    return HttpResponse.json({ job_id: `job_reparse${world.seq}` });
  }),
];

/** 调试与端到端测试用的开关（挂在 window.__mnMock 上） */
export const worldControls = {
  resetWorld,
  /** 把某个文档直接置为解析失败 */
  failDocument(did: ID, message = '解析失败'): boolean {
    const e = findDoc(did);
    if (!e) return false;
    e.startedAt = undefined;
    e.failWith = undefined;
    e.doc = { ...e.doc, parse_status: 'failed', progress: 0, parse_error: message };
    return true;
  },
  /** 清空项目列表（演示首次启动自动建“默认项目”） */
  clearProjects(): void {
    world.projects = [];
  },
};

// ---------------------------------------------------------------- F3 追加
/** F3：新建对话或标题变化后写回项目的对话列表（已存在则替换并移到最前，否则插到最前） */
export function upsertConversationSummary(pid: ID, summary: ConversationSummary): void {
  const before = world.conversations.get(pid) ?? [];
  const list = before.filter((c) => c.id !== summary.id);
  world.conversations.set(pid, [summary, ...list]);
  const p = world.projects.find((x) => x.id === pid);
  if (p && list.length === before.length) p.conversation_count += 1;
}
