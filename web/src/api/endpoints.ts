// 接口清单与请求/响应包装类型。
// 全部由 docs/contract/rest-api.md 的表格逐行转写，只组合 ./types.ts 中已有的类型，不新增字段。
// scripts/check-fixtures.ts 会解析 rest-api.md，确认这里的清单与契约逐条一致。
import type {
  Branch,
  ConversationPlugin,
  ConversationSummary,
  DocGroup,
  Document,
  ID,
  ISODate,
  InstalledPlugin,
  MarketItem,
  MemoryItem,
  Message,
  Project,
  ProviderId,
  ProviderPreset,
  Settings,
  Skill,
} from './types';

// ---------- 项目与对话 ----------
export interface ProjectList {
  projects: Project[];
}
export interface CreateProjectBody {
  name: string;
}
export interface ConversationPage {
  conversations: ConversationSummary[];
  next_cursor?: string;
}
export interface CreateConversationBody {
  title?: string;
}
export interface SetActiveLeafBody {
  message_id: ID;
}
export interface ActiveLeafResult {
  active_leaf_id: ID;
}

// ---------- 消息 ----------
export interface OkResult {
  ok: true;
}

// ---------- 分支 ----------
export interface MergeResult {
  branch: Branch;
  merge_note: Message;
}
export type UpdateBranchBody = { status: 'archived' } | { title: string };

// ---------- 材料与证据 ----------
/** 契约 v0.2：按 `Document.group` 分组，顺序 paper、slides、code、notes、web */
export interface DocumentGroup {
  group: DocGroup;
  documents: Document[];
}
export interface DocumentGroups {
  groups: DocumentGroup[];
}
export interface UploadResult {
  documents: Document[];
  job_ids: ID[];
}
export interface JobResult {
  job_id: ID;
}

// ---------- 市场、插件与 Skill ----------
export interface MarketList {
  items: MarketItem[];
}
export interface PluginList {
  plugins: InstalledPlugin[];
}
export interface InstallPluginBody {
  config: Record<string, string>;
}
export interface ConversationPluginList {
  plugins: ConversationPlugin[];
}
export interface SetConversationPluginsBody {
  enabled_plugin_ids: ID[];
}
export interface SkillList {
  skills: Skill[];
}
export interface ImportSkillBody {
  source: 'github' | 'local';
  url?: string;
  path?: string;
}
export interface UpdateSkillBody {
  enabled: boolean;
}

// ---------- 设置与记忆 ----------
/** `PUT /api/settings`：`Partial<Settings>`，另可带只写的 `api_key`（rest-api.md 第 92 行）。 */
export type UpdateSettingsBody = Partial<Settings> & { api_key?: string };
/** v0.5 [BYOK] `GET /api/settings/providers` */
export interface ProviderList {
  providers: ProviderPreset[];
}
/** v0.5 [BYOK] `POST /api/settings/test`：用当前填写值测试，未给的字段沿用已保存值；`api_key` 省略＝用已保存的密钥 */
export interface SettingsTestBody {
  provider?: ProviderId;
  api_base?: string;
  api_key?: string;
  chat_model?: string;
  small_model?: string;
  embedding_model?: string;
}
export interface MemoryItemList {
  items: MemoryItem[];
}
export interface UpdateMemoryItemBody {
  content: string;
}
export interface MemorySummary {
  content: string;
  version: number;
  updated_at: ISODate;
}

// ---------- 接口清单 ----------
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** 响应类型名对应 types.ts / 本文件中的导出名；`sse` 表示事件流，`raw` 表示原文件。 */
export interface EndpointDef {
  method: HttpMethod;
  /** 与 rest-api.md 完全一致的路径（含 `{pid}` 占位，不含查询串） */
  path: string;
  request?: string;
  response: string;
}

export const ENDPOINTS: EndpointDef[] = [
  { method: 'GET', path: '/api/projects', response: 'ProjectList' },
  { method: 'POST', path: '/api/projects', request: 'CreateProjectBody', response: 'Project' },
  { method: 'GET', path: '/api/projects/{pid}/conversations', response: 'ConversationPage' },
  {
    method: 'POST',
    path: '/api/projects/{pid}/conversations',
    request: 'CreateConversationBody',
    response: 'Conversation',
  },
  { method: 'GET', path: '/api/conversations/{cid}/tree', response: 'ConversationTree' },
  {
    method: 'PUT',
    path: '/api/conversations/{cid}/active_leaf',
    request: 'SetActiveLeafBody',
    response: 'ActiveLeafResult',
  },
  {
    method: 'POST',
    path: '/api/conversations/{cid}/messages',
    request: 'SendMessageBody',
    response: 'sse',
  },
  { method: 'GET', path: '/api/messages/{mid}/events', response: 'sse' },
  { method: 'POST', path: '/api/messages/{mid}/cancel', response: 'OkResult' },
  { method: 'POST', path: '/api/messages/{mid}/regenerate', response: 'sse' },
  { method: 'POST', path: '/api/branches', request: 'CreateBranchBody', response: 'Branch' },
  { method: 'POST', path: '/api/branches/{bid}/merge', response: 'MergeResult' },
  { method: 'PUT', path: '/api/branches/{bid}', request: 'UpdateBranchBody', response: 'Branch' },
  { method: 'GET', path: '/api/projects/{pid}/documents', response: 'DocumentGroups' },
  { method: 'POST', path: '/api/projects/{pid}/documents', response: 'UploadResult' },
  { method: 'GET', path: '/api/documents/{did}', response: 'Document' },
  { method: 'GET', path: '/api/documents/{did}/raw', response: 'raw' },
  { method: 'POST', path: '/api/documents/{did}/reparse', response: 'JobResult' },
  { method: 'GET', path: '/api/evidence/{eid}', response: 'Evidence' },
  { method: 'GET', path: '/api/web_snapshots/{sid}', response: 'WebSnapshot' },
  { method: 'GET', path: '/api/market/plugins', response: 'MarketList' },
  { method: 'GET', path: '/api/market/skills', response: 'MarketList' },
  { method: 'GET', path: '/api/plugins', response: 'PluginList' },
  { method: 'GET', path: '/api/plugins/{id}', response: 'PluginDetail' },
  {
    method: 'POST',
    path: '/api/plugins/{id}',
    request: 'InstallPluginBody',
    response: 'InstalledPlugin',
  },
  { method: 'DELETE', path: '/api/plugins/{id}', response: 'OkResult' },
  {
    method: 'GET',
    path: '/api/conversations/{cid}/plugins',
    response: 'ConversationPluginList',
  },
  {
    method: 'PUT',
    path: '/api/conversations/{cid}/plugins',
    request: 'SetConversationPluginsBody',
    response: 'ConversationPluginList',
  },
  { method: 'GET', path: '/api/skills', response: 'SkillList' },
  { method: 'GET', path: '/api/skills/{id}', response: 'SkillDetail' },
  { method: 'POST', path: '/api/skills/import', request: 'ImportSkillBody', response: 'Skill' },
  { method: 'PUT', path: '/api/skills/{id}', request: 'UpdateSkillBody', response: 'Skill' },
  { method: 'GET', path: '/api/settings', response: 'Settings' },
  { method: 'PUT', path: '/api/settings', request: 'UpdateSettingsBody', response: 'Settings' },
  { method: 'GET', path: '/api/settings/providers', response: 'ProviderList' },
  { method: 'POST', path: '/api/settings/test', request: 'SettingsTestBody', response: 'SettingsTestResult' },
  { method: 'GET', path: '/api/memory/items', response: 'MemoryItemList' },
  {
    method: 'PUT',
    path: '/api/memory/items/{id}',
    request: 'UpdateMemoryItemBody',
    response: 'MemoryItem',
  },
  { method: 'DELETE', path: '/api/memory/items/{id}', response: 'OkResult' },
  { method: 'GET', path: '/api/memory/summary', response: 'MemorySummary' },
];

/** `GET /api/projects` → `get-projects`；`{pid}` 等占位保留名字。fixture 文件名用它做前缀。 */
export function endpointSlug(def: Pick<EndpointDef, 'method' | 'path'>): string {
  const p = def.path
    .replace(/^\/api\//, '')
    .replace(/[{}]/g, '')
    .replace(/\//g, '-');
  return `${def.method.toLowerCase()}-${p}`;
}
