// Mnemosyne 接口类型草案 v0.3（2026-11-23；v0.3 只追加可选字段）；v0.5 并行草案只追加 short_name?、Step.plugin_id?（F6b）
// 来源：docs/contract/*.md。F0 里程碑把本文件拷到 web/src/api/types.ts，之后两处保持一致。
// 字段保持 snake_case，与后端 JSON 一致。
// 字符偏移（sentence_start/end、anchor_start/end、char_range）一律左闭右开、按 Unicode 码点计数；
// lines 是从 1 开始的闭区间行号（contract/README.md 第 7 条）。

export type ID = string;
export type ISODate = string;

export interface ApiError { error: { code: ErrorCode; message: string; retriable: boolean; details?: Record<string, unknown> } }
export type ErrorCode =
  | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'NOT_VISIBLE_ON_PATH' | 'PARSE_FAILED'
  | 'MODEL_UNAVAILABLE' | 'PLUGIN_SELF_CHECK_FAILED' | 'PLUGIN_TIMEOUT' | 'SKILL_INVALID' | 'INTERNAL';

// ---------- 项目与对话 ----------
export interface Project { id: ID; name: string; created_at: ISODate; conversation_count: number }
export interface ConversationSummary { id: ID; title: string; updated_at: ISODate; branch_count: number }
export interface Conversation {
  id: ID; project_id: ID; title: string;
  root_message_id?: ID; active_leaf_id?: ID; created_at: ISODate; updated_at: ISODate;
}
export type Role = 'user' | 'assistant' | 'tool' | 'merge_note';
export interface Message {
  id: ID; conversation_id: ID; parent_id?: ID; branch_id?: ID; role: Role; content: string;
  model?: string; usage?: Usage; created_at: ISODate; steps?: Step[]; citations?: Citation[];
}
export interface Usage { prompt_tokens: number; completion_tokens: number }
export interface ConversationTree { conversation: Conversation; messages: Message[]; branches: Branch[]; active_leaf_id?: ID }

export interface Scope { mode: 'all' | 'selected' | 'none'; document_ids?: ID[] }
export interface SendMessageBody {
  client_msg_id: string; content: string; parent_id?: ID; branch_id?: ID;
  web_search: boolean; scope: Scope; forced_skill?: string;
}

// ---------- 分支 ----------
export type BranchStatus = 'open' | 'merged' | 'archived';
export interface Branch {
  id: ID; conversation_id: ID; fork_message_id: ID;
  anchor_start: number; anchor_end: number; anchor_quote: string; title: string;
  status: BranchStatus; merged_into_message_id?: ID; created_at: ISODate; context_turns: number;
}
export interface CreateBranchBody { conversation_id: ID; fork_message_id: ID; anchor: { start: number; end: number; quote: string } }

// ---------- 材料与证据 ----------
export type DocKind = 'pdf' | 'pptx' | 'code' | 'ipynb' | 'md' | 'web';
export type DocGroup = 'paper' | 'slides' | 'code' | 'notes' | 'web';
export type ParseStatus = 'queued' | 'parsing' | 'ready' | 'failed';
export interface Document {
  id: ID; project_id: ID; kind: DocKind; group: DocGroup; title: string; pages?: number; lines?: number;
  cells?: number;        // 仅 ipynb
  snapshot_id?: ID;      // 仅 kind=web，指向 WebSnapshot.id
  parse_status: ParseStatus; progress: number; parse_error?: string; cited_count: number; created_at: ISODate;
}
export type SourceType = 'material' | 'web' | 'message' | 'plugin';
export type Locator =
  | { page: number; sentence_ids: string[]; bbox: [number, number, number, number] }   // pdf
  | { slide: number; shape_id: number; char_range: [number, number] }                  // pptx
  | { path: string; lines: [number, number]; cell?: number }                           // code / md / ipynb
  | { snapshot_id: ID; char_range: [number, number] }                                  // web
  | { message_id: ID; char_range: [number, number] }                                   // message
  | { plugin_id: ID; tool_name: string; fields: Record<string, unknown> };             // plugin (无 URL)
export interface Evidence {
  id: ID; label?: string; source_type: SourceType; source_id: ID; title: string;
  locator: Locator; quote: string; sha256?: string; cited_by?: { message_id: ID; label: string }[];
  context_messages?: Message[];  // 仅 source_type=message：被引消息本身及前后各 1 条，最多 3 条
}
export interface WebSnapshot { id: ID; url: string; title: string; fetched_at: ISODate; text: string; sha256: string; http_status: number }

// ---------- SSE ----------
export type StepKind = 'search_materials' | 'search_web' | 'fetch_url' | 'recall_memory' | 'open_source' | 'plugin_tool' | 'load_skill';
export interface Step {
  step_id: ID; kind: StepKind; label: string; status: 'running' | 'done' | 'error'; duration_ms?: number;
  plugin_id?: ID; // v0.5 [F6b]（原 U60）：kind=plugin_tool 时发起调用的插件 id；会话插件弹层据此统计“本轮调用 N 次”，缺省时前端退回按 label 匹配
}
export type Verdict = 'supported' | 'partial' | 'removed';
export interface Citation { citation_id: ID; eid: ID; label: string; sentence_start: number; sentence_end: number; verdict: Verdict }
export type SseEvent =
  | { event: 'message.start'; data: { seq: number; message_id: ID; client_msg_id: string; user_message_id: ID; parent_id?: ID; branch_id?: ID } }
  | { event: 'step'; data: Step & { seq: number } }
  | { event: 'evidence'; data: { seq: number; eid: ID; label: string; source_type: SourceType; source_id: ID; title: string; locator: Locator; quote: string; sha256?: string } }
  | { event: 'delta'; data: { seq: number; text: string } }
  | { event: 'citation'; data: Citation & { seq: number } }
  | { event: 'message.end'; data: { seq: number; message_id: ID; usage: Usage; latency_ms: number; cancelled: boolean } }
  | { event: 'error'; data: { seq: number; code: ErrorCode; message: string; retriable: boolean } };

// ---------- 市场 / 插件 / Skill ----------
export interface MarketItem {
  id: ID; type: 'plugin' | 'skill'; name: string; owner: string; official: boolean;
  stars: number; stars_date: string; license: string; category: string; desc_zh: string; repo_url: string; installed: boolean;
  verified?: boolean; // v0.3：是否属于 v1 完整验收（只对插件有意义）
  short_name?: string; // v0.5 草案 [B3b]：插件简称（输入框插件胶囊用），只对插件
}
export interface InstalledPlugin {
  id: ID; name: string; version: string; status: 'installed' | 'error' | 'disabled' | 'not_installed';
  permissions: ('network' | 'fs_read' | 'fs_write' | 'exec')[];
  config_schema: Record<string, { required: boolean; secret: boolean; label: string }>; last_check_at?: ISODate;
  config_set?: string[]; // v0.3：已设置的配置键名（含密钥键名，不回传密钥值）
  config?: Record<string, string | number | boolean>; // v0.3：已存的非密钥配置值
  short_name?: string; // v0.5 草案 [B3b]：插件简称
}
export interface PluginDetail extends InstalledPlugin {
  tools: { name: string; description: string }[]; verified: boolean;
  // v0.3：适配清单（mnemosyne-plugin.json）的启动信息；tools_allow 省略＝全部工具开放
  manifest?: { transport: 'stdio' | 'http'; command: string; args: string[]; tools_allow?: string[] };
  about_zh?: string; // v0.3：详情页简介
  usage_zh?: string; // v0.3：“在 Mnemosyne 里怎么用”
  permission_notes?: Partial<Record<InstalledPlugin['permissions'][number], string>>; // v0.3：每项权限的具体范围
}
export interface ConversationPlugin { plugin_id: ID; enabled: boolean; status: InstalledPlugin['status']; reason?: string; short_name?: string /* v0.5 草案 [B3b] */ }
export interface Skill { id: ID; name: string; description: string; dir_path: string; source_url?: string; license?: string; enabled: boolean }
export interface SkillDetail extends Skill { skill_md: string; files: string[] }

// ---------- 设置与记忆 ----------
export interface Settings {
  chat_model: string; small_model: string; embedding_model: string; api_base: string;
  api_key_set: boolean; web_search_default: boolean; memory_enabled: boolean;
}
export interface MemoryItem {
  id: ID; scope: 'global' | 'project' | 'branch'; scope_id?: ID; topic: string; content: string;
  source_message_ids: ID[]; status: 'active' | 'superseded' | 'deleted'; valid_from?: ISODate; valid_to?: ISODate; confidence: number;
  source_conversation_id?: ID; // v0.3：来源消息所在对话，“查看来源”据此跳转
}
