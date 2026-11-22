// 有状态的模拟后端（F6）：市场、插件安装/自检/卸载、会话插件开关、Skill 导入/启用、设置、记忆条目。
// 初始数据全部取自 docs/contract/fixtures 与 market-data.ts（GitHub 真实条目）；fixture 没有的少量演示数据在本文件写明来源，遵守 R4。
// 规则同 world.ts：
//   - 某接口用 setMockScenario 指定了场景时，本层不处理，交回 handlers.ts（F0 的场景开关继续有效）；
//   - 状态只在内存里，刷新页面即恢复初始数据。
import { http, HttpResponse, delay, type HttpHandler } from 'msw';
import type {
  ConversationPluginList,
  ImportSkillBody,
  InstallPluginBody,
  MarketList,
  MemoryItemList,
  PluginList,
  SkillList,
  UpdateSettingsBody,
} from '../api/endpoints';
import type {
  ApiError,
  ConversationPlugin,
  ID,
  InstalledPlugin,
  MarketItem,
  MemoryItem,
  PluginDetail,
  Settings,
  Skill,
  SkillDetail,
} from '../api/types';
import type { RestFixture } from './fixture-types';
import { fixtures, getMockScenario } from './handlers';
import { MARKET_DATA } from './market-data';

/** 安装自检的模拟耗时（规格 3-安装-安装确认弹窗：约 5–30 s；演示缩短为 1.5 s，测试可改） */
let selfCheckMs = 1500;

/**
 * ArXiv MCP Server 上游完整工具清单：19 个工具名取自其 GitHub README「Tools」表（2026-11-23 核对），
 * 中文说明译自该表 Purpose 列。顺序：概念图 UI-09 列出的常用 8 个在前，其余按 README 顺序。
 * 契约 v0.2 的 fixture（get-plugins-id.ok.json）只列了 4 个；是否把 fixture 改为 19 个见未决 U28。
 */
const ARXIV_UPSTREAM_TOOLS: PluginDetail['tools'] = [
  { name: 'search_papers', description: '按关键词、分类、日期与排序检索 arXiv' },
  { name: 'get_abstract', description: '按 arXiv ID 取元数据与摘要，不下载全文' },
  { name: 'download_paper', description: '下载论文并转成本地 Markdown' },
  { name: 'get_paper_outline', description: '分页返回论文的章节目录' },
  { name: 'read_paper_section', description: '读取某一节正文（有长度上限）' },
  { name: 'search_paper_text', description: '在单篇论文内检索段落，返回原文偏移' },
  { name: 'export_citations', description: '导出 BibTeX' },
  { name: 'citation_graph', description: '查参考文献与被引（经 Semantic Scholar）' },
  { name: 'list_papers', description: '列出本地已保存的论文' },
  { name: 'read_paper', description: '读取本地论文正文（默认有长度上限）' },
  { name: 'get_paper_latex', description: '读取作者提交的 LaTeX 源（有长度上限）' },
  { name: 'list_paper_latex_sections', description: '分页返回 LaTeX 章节目录' },
  { name: 'get_paper_latex_section', description: '读取 LaTeX 的某一节' },
  { name: 'watch_topic', description: '保存或更新一个 arXiv 主题订阅' },
  { name: 'list_watches', description: '列出已保存的主题订阅' },
  { name: 'check_alerts', description: '检查订阅主题有没有新论文' },
  { name: 'unwatch_topic', description: '删除一个主题订阅' },
  { name: 'semantic_search', description: '在已下载论文中按语义检索（需 [pro] 依赖）' },
  { name: 'reindex', description: '重建本地语义索引（需 [pro] 依赖）' },
];

/** v1 完整验收的两个插件（plugin-manifest.md） */
export const VERIFIED_PLUGIN_IDS: readonly ID[] = ['arxiv', 'fetch'];

/**
 * 演示用的历史版本记忆（fixture 只有 active 条目）：mem_hw3_sigmoid 被更新前的旧说法，
 * 用来演示规格 3-设置-记忆管理 的“显示历史版本”。
 */
const SUPERSEDED_DEMO: MemoryItem = {
  id: 'mem_hw3_sigmoid_v1',
  scope: 'project',
  scope_id: 'prj_dlintro',
  topic: '反向传播',
  content: '作业 3 的梯度全为 0，原因未明。',
  source_message_ids: ['msg_hw3_a2'],
  status: 'superseded',
  valid_from: '2026-11-20T10:00:00Z',
  valid_to: '2026-11-21T13:05:00Z',
  confidence: 0.6,
};

interface MarketWorld {
  plugins: InstalledPlugin[];
  skills: Skill[];
  convPlugins: Map<ID, ConversationPlugin[]>;
  settings: Settings;
  memory: MemoryItem[];
  /** 安装时自检必然失败的插件 id → 错误体 */
  failing: Map<ID, ApiError>;
  /** 设置保存后模拟“测试调用失败” */
  modelUnavailable: boolean;
}

const fx = (file: string) => fixtures[file] as RestFixture;
const body = <T>(file: string) => structuredClone(fx(file).body as T);
const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function initialWorld(): MarketWorld {
  const convFx = fx('get-conversations-cid-plugins.ok.json');
  const convPlugins = new Map<ID, ConversationPlugin[]>();
  convPlugins.set(
    convFx.request?.params?.cid ?? 'cnv_transformer',
    body<ConversationPluginList>('get-conversations-cid-plugins.ok.json').plugins,
  );
  const failFx = fx('post-plugins-id.error.json');
  const failing = new Map<ID, ApiError>();
  failing.set(failFx.request?.params?.id ?? 'docling', structuredClone(failFx.body as ApiError));
  return {
    plugins: body<PluginList>('get-plugins.ok.json').plugins,
    skills: body<SkillList>('get-skills.ok.json').skills,
    convPlugins,
    settings: body<Settings>('get-settings.ok.json'),
    memory: [...body<MemoryItemList>('get-memory-items.ok.json').items, structuredClone(SUPERSEDED_DEMO)],
    failing,
    modelUnavailable: false,
  };
}

let world = initialWorld();

export function resetMarketWorld(): void {
  world = initialWorld();
}

const err = (status: number, code: string, message: string, retriable = false, details?: Record<string, unknown>) =>
  HttpResponse.json({ error: { code, message, retriable, ...(details ? { details } : {}) } }, { status });

const deferred = (endpoint: string) => getMockScenario(endpoint) !== undefined;

const marketItem = (id: ID) => MARKET_DATA.find((m) => m.id === id);
const normUrl = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();

function marketList(type: 'plugin' | 'skill'): MarketList {
  const installed = new Set(type === 'plugin' ? world.plugins.map((p) => p.id) : world.skills.map((s) => s.id));
  return {
    items: MARKET_DATA.filter((m) => m.type === type).map((m): MarketItem => ({
      ...m,
      installed: installed.has(m.id),
    })),
  };
}

/** 插件详情：有 fixture 的（arxiv、tavily）用 fixture 的权限与配置项；其余条目没有 manifest 样例，只给名称，工具与权限留空 */
function pluginDetail(id: ID): PluginDetail | null {
  const installed = world.plugins.find((p) => p.id === id);
  const detailFx = Object.values(fixtures).find(
    (f): f is RestFixture =>
      f.endpoint === 'GET /api/plugins/{id}' && f.kind !== 'error' && f.request?.params?.id === id,
  );
  const base = detailFx ? structuredClone(detailFx.body as PluginDetail) : null;
  const m = marketItem(id);
  if (!base && !m && !installed) return null;
  const detail: PluginDetail = {
    id,
    name: installed?.name ?? base?.name ?? m?.name ?? id,
    version: installed?.version ?? base?.version ?? '1.0.0',
    status: installed ? installed.status : 'not_installed',
    permissions: installed?.permissions ?? base?.permissions ?? [],
    config_schema: installed?.config_schema ?? base?.config_schema ?? {},
    tools: id === 'arxiv' ? structuredClone(ARXIV_UPSTREAM_TOOLS) : (base?.tools ?? []),
    verified: VERIFIED_PLUGIN_IDS.includes(id),
  };
  if (installed?.last_check_at) detail.last_check_at = installed.last_check_at;
  return detail;
}

function skillDetail(s: Skill): SkillDetail {
  const f = fixtures['get-skills-id.ok.json'] as RestFixture;
  if (f.request?.params?.id === s.id) return { ...structuredClone(f.body as SkillDetail), enabled: s.enabled };
  // 其余 Skill 没有 SKILL.md 样例：只按头部字段拼出 front matter，正文留空
  const head = ['---', `name: ${s.name}`, `description: ${s.description}`];
  if (s.license) head.push(`license: ${s.license}`);
  head.push('---', '');
  return { ...s, skill_md: head.join('\n'), files: ['SKILL.md'] };
}

function convList(cid: ID): ConversationPlugin[] {
  const saved = world.convPlugins.get(cid) ?? [];
  // 只列已安装的插件；卸载后开关消失（规格 3-插件详情-卸载）
  return world.plugins.map((p) => {
    const hit = saved.find((c) => c.plugin_id === p.id);
    return { plugin_id: p.id, enabled: hit?.enabled ?? false, status: p.status };
  });
}

export const marketWorldHandlers: HttpHandler[] = [
  http.get('*/api/market/plugins', () => {
    if (deferred('GET /api/market/plugins')) return undefined;
    return HttpResponse.json(marketList('plugin'));
  }),
  http.get('*/api/market/skills', () => {
    if (deferred('GET /api/market/skills')) return undefined;
    return HttpResponse.json(marketList('skill'));
  }),

  http.get('*/api/plugins', () => {
    if (deferred('GET /api/plugins')) return undefined;
    return HttpResponse.json({ plugins: world.plugins } satisfies PluginList);
  }),
  http.get('*/api/plugins/:id', ({ params }) => {
    if (deferred('GET /api/plugins/{id}')) return undefined;
    const d = pluginDetail(String(params.id));
    return d ? HttpResponse.json(d) : err(404, 'NOT_FOUND', '插件不存在');
  }),
  http.post('*/api/plugins/:id', async ({ params, request }) => {
    if (deferred('POST /api/plugins/{id}')) return undefined;
    const id = String(params.id);
    const d = pluginDetail(id);
    if (!d) return err(404, 'NOT_FOUND', '插件不存在');
    const input = (await request.json().catch(() => ({}))) as Partial<InstallPluginBody>;
    const config = input.config ?? {};
    const already = world.plugins.find((p) => p.id === id);
    const missing = Object.entries(d.config_schema).find(
      ([k, f]) => f.required && !config[k]?.trim() && !(already && f.secret),
    );
    if (missing) return err(400, 'VALIDATION_ERROR', `缺少必填项：${missing[1].label}`);
    await delay(selfCheckMs);
    const fail = world.failing.get(id);
    if (fail) return HttpResponse.json(structuredClone(fail), { status: 502 });
    const plugin: InstalledPlugin = {
      id,
      name: d.name,
      version: d.version,
      status: 'installed',
      permissions: d.permissions,
      config_schema: d.config_schema,
      last_check_at: iso(),
    };
    world.plugins = already ? world.plugins.map((p) => (p.id === id ? plugin : p)) : [...world.plugins, plugin];
    return HttpResponse.json(plugin);
  }),
  http.delete('*/api/plugins/:id', ({ params }) => {
    if (deferred('DELETE /api/plugins/{id}')) return undefined;
    const id = String(params.id);
    if (!world.plugins.some((p) => p.id === id)) return err(404, 'NOT_FOUND', '插件未安装');
    world.plugins = world.plugins.filter((p) => p.id !== id);
    for (const [cid, list] of world.convPlugins)
      world.convPlugins.set(
        cid,
        list.filter((c) => c.plugin_id !== id),
      );
    return HttpResponse.json({ ok: true });
  }),

  http.get('*/api/conversations/:cid/plugins', ({ params }) => {
    if (deferred('GET /api/conversations/{cid}/plugins')) return undefined;
    return HttpResponse.json({ plugins: convList(String(params.cid)) } satisfies ConversationPluginList);
  }),
  http.put('*/api/conversations/:cid/plugins', async ({ params, request }) => {
    if (deferred('PUT /api/conversations/{cid}/plugins')) return undefined;
    const cid = String(params.cid);
    const input = (await request.json().catch(() => ({}))) as { enabled_plugin_ids?: unknown };
    if (!Array.isArray(input.enabled_plugin_ids)) return err(400, 'VALIDATION_ERROR', 'enabled_plugin_ids 必须是数组');
    const on = new Set(input.enabled_plugin_ids.map(String));
    world.convPlugins.set(
      cid,
      world.plugins.map((p) => ({ plugin_id: p.id, enabled: on.has(p.id), status: p.status })),
    );
    return HttpResponse.json({ plugins: convList(cid) } satisfies ConversationPluginList);
  }),

  http.get('*/api/skills', () => {
    if (deferred('GET /api/skills')) return undefined;
    return HttpResponse.json({ skills: world.skills } satisfies SkillList);
  }),
  http.post('*/api/skills/import', async ({ request }) => {
    if (deferred('POST /api/skills/import')) return undefined;
    const input = (await request.json().catch(() => ({}))) as Partial<ImportSkillBody>;
    await delay(400);
    if (input.source === 'github') {
      const url = normUrl(input.url ?? '');
      const m = MARKET_DATA.find((x) => x.type === 'skill' && normUrl(x.repo_url) === url);
      if (!m) return err(404, 'NOT_FOUND', '该地址下没有找到 SKILL.md（模拟后端只认识市场里的 12 个 Skill）');
      const existing = world.skills.find((s) => s.id === m.id);
      if (existing) return HttpResponse.json(existing);
      const skill: Skill = {
        id: m.id,
        name: m.name,
        description: m.desc_zh,
        dir_path: `~/.mnemosyne/skills/${m.id}`,
        source_url: m.repo_url,
        license: m.license,
        enabled: true,
      };
      world.skills = [...world.skills, skill];
      return HttpResponse.json(skill);
    }
    if (input.source === 'local') {
      // 模拟后端读不到本机目录：一律按 fixture 的 SKILL_INVALID 应答
      return HttpResponse.json(body<ApiError>('post-skills-import.error.json'), { status: 422 });
    }
    return err(400, 'VALIDATION_ERROR', 'source 必须是 github 或 local');
  }),
  http.get('*/api/skills/:id', ({ params }) => {
    if (deferred('GET /api/skills/{id}')) return undefined;
    const s = world.skills.find((x) => x.id === String(params.id));
    return s ? HttpResponse.json(skillDetail(s)) : err(404, 'NOT_FOUND', 'Skill 未安装');
  }),
  http.put('*/api/skills/:id', async ({ params, request }) => {
    if (deferred('PUT /api/skills/{id}')) return undefined;
    const id = String(params.id);
    const input = (await request.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof input.enabled !== 'boolean') return err(400, 'VALIDATION_ERROR', 'enabled 必须是布尔值');
    const s = world.skills.find((x) => x.id === id);
    if (!s) return err(404, 'NOT_FOUND', 'Skill 未安装');
    s.enabled = input.enabled;
    return HttpResponse.json(s);
  }),

  http.get('*/api/settings', () => {
    if (deferred('GET /api/settings')) return undefined;
    return HttpResponse.json(world.settings);
  }),
  http.put('*/api/settings', async ({ request }) => {
    if (deferred('PUT /api/settings')) return undefined;
    const input = (await request.json().catch(() => ({}))) as UpdateSettingsBody;
    if (input.api_base !== undefined && !/^https?:\/\/\S+$/.test(input.api_base)) {
      return HttpResponse.json(body<ApiError>('put-settings.error.json'), { status: 400 });
    }
    const { api_key, api_key_set: _ignored, ...rest } = input;
    world.settings = { ...world.settings, ...rest };
    if (typeof api_key === 'string' && api_key.length > 0) world.settings.api_key_set = true;
    const touchesModel =
      ['api_base', 'chat_model', 'small_model', 'embedding_model'].some((k) => k in input) || !!api_key;
    if (world.modelUnavailable && touchesModel) {
      return err(502, 'MODEL_UNAVAILABLE', '测试调用失败：模型接口返回 401（Key 无效）', true);
    }
    return HttpResponse.json(world.settings);
  }),

  http.get('*/api/memory/items', ({ request }) => {
    if (deferred('GET /api/memory/items')) return undefined;
    const sp = new URL(request.url).searchParams;
    const scope = sp.get('scope');
    const q = (sp.get('q') ?? '').trim().toLowerCase();
    const status = sp.get('status');
    const items = world.memory.filter(
      (m) =>
        m.status !== 'deleted' &&
        (!status || m.status === status) &&
        (!scope || m.scope === scope) &&
        (!q || m.content.toLowerCase().includes(q) || m.topic.toLowerCase().includes(q)),
    );
    return HttpResponse.json({ items } satisfies MemoryItemList);
  }),
  http.put('*/api/memory/items/:id', async ({ params, request }) => {
    if (deferred('PUT /api/memory/items/{id}')) return undefined;
    const m = world.memory.find((x) => x.id === String(params.id) && x.status === 'active');
    if (!m) return err(404, 'NOT_FOUND', '记忆条目不存在');
    const input = (await request.json().catch(() => ({}))) as { content?: unknown };
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (!content) return err(400, 'VALIDATION_ERROR', '内容不能为空');
    m.content = content;
    return HttpResponse.json(m);
  }),
  http.delete('*/api/memory/items/:id', ({ params }) => {
    if (deferred('DELETE /api/memory/items/{id}')) return undefined;
    const m = world.memory.find((x) => x.id === String(params.id) && x.status !== 'deleted');
    if (!m) return err(404, 'NOT_FOUND', '记忆条目不存在');
    m.status = 'deleted'; // 进屏蔽列表：不再出现在任何列表里
    return HttpResponse.json({ ok: true });
  }),
];

/** 调试与端到端测试用的开关（合并到 window.__mnMock） */
export const marketControls = {
  resetMarketWorld,
  /** 让某个插件安装时自检失败（默认 fixture 已让 docling 失败） */
  failPluginInstall(id: ID, logTail = '[mnemosyne] tools/list failed'): void {
    world.failing.set(id, {
      error: {
        code: 'PLUGIN_SELF_CHECK_FAILED',
        message: '插件启动失败',
        retriable: true,
        details: { log_tail: logTail },
      },
    });
  },
  /** 取消某个插件的“必然失败” */
  passPluginInstall(id: ID): void {
    world.failing.delete(id);
  },
  setSelfCheckMs(ms: number): void {
    selfCheckMs = Math.max(0, ms);
  },
  /** 设置保存后测试调用失败（MODEL_UNAVAILABLE） */
  setModelUnavailable(on: boolean): void {
    world.modelUnavailable = on;
  },
};
