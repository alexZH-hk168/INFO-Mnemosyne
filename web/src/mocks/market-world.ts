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
  ProviderList,
  SettingsTestBody,
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
  SettingsTestResult,
  Skill,
  SkillDetail,
} from '../api/types';
import type { RestFixture } from './fixture-types';
import { fixtures, getMockScenario } from './handlers';
import { MARKET_DATA, notAdaptedMessage, PLUGIN_MANIFESTS, PLUGIN_SHORT_NAMES, withShortName } from './market-data';

/** 安装自检的模拟耗时（规格 3-安装-安装确认弹窗：约 5–30 s；演示缩短为 1.5 s，测试可改） */
let selfCheckMs = 1500;

/** v1 完整验收的插件：取自市场 fixture 的 verified 字段（契约 v0.3） */
function verifiedIds(): Set<ID> {
  const f = fixtures['get-market-plugins.ok.json'] as RestFixture | undefined;
  const items = f ? (f.body as MarketList).items : [];
  return new Set(items.filter((m) => m.verified).map((m) => m.id));
}

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
  /** v0.5 [BYOK]：已保存的密钥（只在模拟层内部用，接口不回传） */
  apiKey: string;
  /** v0.5 [BYOK]：测试连接的固定结果（不设置时按填写值是否齐全给 ok / not_configured） */
  testResult: SettingsTestResult | null;
  /** F6b 追加：会话插件接口的 reason（插件不可用的原因，如“本机 Zotero 未连接”）；只有演示场景会填 */
  reasons: Map<ID, string>;
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
    apiKey: '',
    testResult: null,
    reasons: new Map(),
  };
}

/** v0.5 [BYOK]：与后端 llm/settings.py 同口径——api_base、API Key、对话模型三项齐全＝real，否则 demo */
function withMode(st: Settings, key: string): Settings {
  const out: Settings = { ...st, api_key_set: st.api_key_set || key.length > 0 };
  if (out.llm_mode !== 'demo_forced') {
    out.llm_mode = out.api_base && out.chat_model && out.api_key_set ? 'real' : 'demo';
  }
  if (key.length >= 12) out.api_key_hint = `••••${key.slice(-4)}`;
  if (!out.api_key_set) delete out.api_key_hint;
  return out;
}

let world = initialWorld();
/** F6b 追加：PUT /api/conversations/{cid}/plugins 是否模拟失败 */
let failPut = false;

export function resetMarketWorld(): void {
  world = initialWorld();
  failPut = false;
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
      ...withShortName(type, m), // F6b：插件带 short_name（契约 v0.5 并行草案）
      installed: installed.has(m.id),
      ...(type === 'plugin' ? { verified: verifiedIds().has(m.id) } : {}),
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
    tools: base?.tools ?? [],
    verified: base?.verified ?? verifiedIds().has(id),
  };
  // F6b：简称（契约 v0.5 并行草案）
  const short = installed?.short_name ?? base?.short_name ?? PLUGIN_SHORT_NAMES[id];
  if (short) detail.short_name = short;
  if (installed?.last_check_at) detail.last_check_at = installed.last_check_at;
  if (installed?.config_set) detail.config_set = [...installed.config_set];
  if (installed?.config) detail.config = { ...installed.config };
  // v0.3 可选字段：只有 fixture 写了的插件才有（arxiv）；F6b：其余有适配清单的（tavily、fetch、markitdown）取 PLUGIN_MANIFESTS
  const manifest = base?.manifest ?? PLUGIN_MANIFESTS[id];
  if (manifest) detail.manifest = structuredClone(manifest);
  if (base?.about_zh) detail.about_zh = base.about_zh;
  if (base?.usage_zh) detail.usage_zh = base.usage_zh;
  if (base?.permission_notes) detail.permission_notes = base.permission_notes;
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
  const saved = world.convPlugins.get(cid);
  // 只列已安装的插件；卸载后开关消失（规格 3-插件详情-卸载）
  // 编排决定（F4 修，待用户追认）：没保存过设置的对话默认启用全部已安装插件，与 UI-09“安装后默认在当前对话启用”一致
  return world.plugins.map((p) => {
    const hit = saved?.find((c) => c.plugin_id === p.id);
    const row: ConversationPlugin = {
      plugin_id: p.id,
      enabled: saved ? (hit?.enabled ?? false) : true,
      status: p.status,
    };
    const reason = world.reasons.get(p.id); // F6b
    if (reason) row.reason = reason;
    return row;
  });
}

/** F6b 追加：某对话当前是否启用了某插件（chat-world 据此决定是否回放插件回合） */
export function isPluginEnabled(cid: ID, pluginId: ID): boolean {
  return convList(cid).some((c) => c.plugin_id === pluginId && c.enabled && c.status === 'installed');
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
    // F6b（编排决定，来自 B3b U92）：没有适配清单的插件不能安装，与后端一样返回 400
    if (!d.manifest) return err(400, 'VALIDATION_ERROR', notAdaptedMessage(id), false);
    const input = (await request.json().catch(() => ({}))) as Partial<InstallPluginBody>;
    const config = input.config ?? {};
    const already = world.plugins.find((p) => p.id === id);
    // 契约 v0.3：未提供的键沿用已存值；空字符串表示清除；密钥只记“已设置”，不回传值
    const set = new Set(already?.config_set ?? []);
    const values: Record<string, string | number | boolean> = { ...(already?.config ?? {}) };
    for (const [k, v] of Object.entries(config)) {
      const field = d.config_schema[k];
      if (!field) continue;
      if (v.trim() === '') {
        set.delete(k);
        delete values[k];
      } else {
        set.add(k);
        if (!field.secret) values[k] = v.trim();
      }
    }
    const missing = Object.entries(d.config_schema).find(([k, f]) => f.required && !set.has(k));
    if (missing) return err(400, 'VALIDATION_ERROR', `缺少必填项：${missing[1].label}`);
    await delay(selfCheckMs);
    const fail = world.failing.get(id);
    if (fail) return HttpResponse.json(structuredClone(fail), { status: 502 });
    const plugin: InstalledPlugin = {
      id,
      name: d.name,
      ...(d.short_name ? { short_name: d.short_name } : {}),
      version: d.version,
      status: 'installed',
      permissions: d.permissions,
      config_schema: d.config_schema,
      last_check_at: iso(),
      config_set: [...set],
      config: values,
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
    if (failPut) return err(500, 'INTERNAL', '保存插件设置失败', true); // F6b：测试开关
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
    const { api_key, api_key_set: _ignored, api_key_hint: _h, llm_mode: _m, retrieval_mode: _r, ...rest } = input;
    world.settings = { ...world.settings, ...rest };
    if (typeof api_key === 'string') {
      world.apiKey = api_key;
      world.settings.api_key_set = api_key.length > 0;
    }
    world.settings = withMode(world.settings, world.apiKey);
    const touchesModel =
      ['api_base', 'chat_model', 'small_model', 'embedding_model'].some((k) => k in input) || !!api_key;
    if (world.modelUnavailable && touchesModel) {
      return err(502, 'MODEL_UNAVAILABLE', '测试调用失败：模型接口返回 401（Key 无效）', true);
    }
    return HttpResponse.json(world.settings);
  }),

  http.get('*/api/settings/providers', () => {
    if (deferred('GET /api/settings/providers')) return undefined;
    return HttpResponse.json(body<ProviderList>('get-settings-providers.ok.json'));
  }),
  http.post('*/api/settings/test', async ({ request }) => {
    if (deferred('POST /api/settings/test')) return undefined;
    const input = (await request.json().catch(() => ({}))) as SettingsTestBody;
    if (input.api_base !== undefined && input.api_base !== '' && !/^https?:\/\/\S+$/.test(input.api_base)) {
      return HttpResponse.json(body<ApiError>('post-settings-test.error.json'), { status: 400 });
    }
    await new Promise((r) => setTimeout(r, 120));
    if (world.testResult) return HttpResponse.json(world.testResult);
    const base = input.api_base ?? world.settings.api_base;
    const chat = input.chat_model ?? world.settings.chat_model;
    const hasKey = !!input.api_key || world.settings.api_key_set;
    if (!base || !chat || !hasKey) {
      const missing = [
        ['API 地址', base],
        ['API Key', hasKey],
        ['对话模型', chat],
      ]
        .filter(([, v]) => !v)
        .map(([n]) => n);
      return HttpResponse.json({
        ok: false,
        code: 'not_configured',
        message: `还缺：${missing.join('、')}`,
        latency_ms: 0,
        tool_calls: 'unknown',
        embeddings: 'not_used',
      } satisfies SettingsTestResult);
    }
    return HttpResponse.json(body<SettingsTestResult>('post-settings-test.ok.json'));
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
  /** v0.5 [BYOK]：切到“未配置模型”的演示模式（get-settings.demo.ok.json） */
  setDemoMode(): void {
    world.settings = body<Settings>('get-settings.demo.ok.json');
    world.apiKey = '';
  },
  /** v0.5 [BYOK]：测试连接返回固定结果；传 null 恢复按填写值判断 */
  setTestResult(r: SettingsTestResult | 'key-invalid' | null): void {
    world.testResult = r === 'key-invalid' ? body<SettingsTestResult>('post-settings-test.key-invalid.ok.json') : r;
  },
  /**
   * F6b 追加：复现概念图 UI-11 的插件组合（截图与弹层状态测试用）。已安装 ArXiv、Tavily（API Key 已配置）、MarkItDown、
   * Zotero（status=error，reason“本机 Zotero 未连接”）；cid 对话里前三个启用。Tavily 的配置项取自
   * get-plugins-id.not-installed.ok.json；Zotero 名称取自市场条目，fixture 没有它的权限与配置样例，这里留空（演示数据，R4）。
   */
  seedUi11(cid: ID = 'cnv_transformer'): void {
    const tavily = pluginDetail('tavily');
    const keep = world.plugins.filter((p) => p.id === 'arxiv' || p.id === 'markitdown');
    const extra: InstalledPlugin[] = [];
    if (tavily) {
      extra.push({
        id: 'tavily',
        name: tavily.name,
        ...(tavily.short_name ? { short_name: tavily.short_name } : {}),
        version: tavily.version,
        status: 'installed',
        permissions: tavily.permissions,
        config_schema: tavily.config_schema,
        last_check_at: iso(),
        config_set: Object.keys(tavily.config_schema),
        config: {},
      });
    }
    const z = marketItem('zotero');
    extra.push({
      id: 'zotero',
      name: z?.name ?? 'zotero',
      short_name: PLUGIN_SHORT_NAMES.zotero,
      version: '1.0.0',
      status: 'error',
      permissions: [],
      config_schema: {},
      config_set: [],
      config: {},
    });
    const order = ['arxiv', 'tavily', 'markitdown', 'zotero'];
    world.plugins = [...keep, ...extra].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    world.reasons.set('zotero', '本机 Zotero 未连接');
    world.convPlugins.set(
      cid,
      world.plugins.map((p) => ({ plugin_id: p.id, enabled: p.id !== 'zotero', status: p.status })),
    );
  },
  /**
   * F6b 追加：直接从模拟后端移除一个已安装插件（等同卸载，不经界面），给“重新安装有适配清单的插件”类测试准备初始状态。
   * 第一版只有 arxiv、tavily、fetch、markitdown 能安装，而前三个初始已装，测“无需配置的安装”只能先移除再装。
   */
  removePlugin(id: ID): void {
    world.plugins = world.plugins.filter((p) => p.id !== id);
    for (const [cid, list] of world.convPlugins)
      world.convPlugins.set(
        cid,
        list.filter((c) => c.plugin_id !== id),
      );
  },
  /** F6b 追加：让某对话的会话插件写接口失败一次以上（测乐观更新回滚）；传 false 恢复 */
  failConvPluginsPut(on: boolean): void {
    failPut = on;
  },
};
