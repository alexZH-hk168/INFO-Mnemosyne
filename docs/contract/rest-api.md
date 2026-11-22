# REST 接口

前缀 `/api`。除上传外请求体为 JSON。响应结构中带 `?` 的字段可为空。立项稿只定义了路径与部分请求体，响应结构为本草案补充（v0.1）。

## 项目与对话

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/projects` | — | `{ projects: Project[] }`，`Project = {id, name, created_at, conversation_count}` |
| POST | `/api/projects` | `{ name }`（1–60 字） | `Project` |
| GET | `/api/projects/{pid}/conversations?cursor=&limit=20` | — | `{ conversations: ConversationSummary[], next_cursor? }`，`ConversationSummary = {id, title, updated_at, branch_count}` |
| POST | `/api/projects/{pid}/conversations` | `{ title? }` | `Conversation` |
| GET | `/api/conversations/{cid}/tree` | — | `{ conversation: Conversation, messages: Message[], branches: Branch[], active_leaf_id }` |
| PUT | `/api/conversations/{cid}/active_leaf` | `{ message_id }` | `{ active_leaf_id }`；用于在重新生成的兄弟回答之间切换 |

`Conversation = {id, project_id, title, root_message_id?, active_leaf_id?, created_at, updated_at}`

`Message = {id, conversation_id, parent_id?, branch_id?, role: "user"|"assistant"|"tool"|"merge_note", content, model?, usage?: {prompt_tokens, completion_tokens}, created_at, steps?: Step[], citations?: Citation[]}`。`steps` 与 `citations` 只在 assistant 消息上返回，结构同 SSE 的 `step`、`citation` 事件。

## 消息

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/conversations/{cid}/messages` | `{ client_msg_id, content, parent_id?, branch_id?, web_search: bool, scope: Scope, forced_skill? }` | `text/event-stream`，见 [sse-events.md](./sse-events.md) |
| GET | `/api/messages/{mid}/events?after_seq=N` | — | 断线续流，同上事件流；回答已结束则补发剩余事件后关闭 |
| POST | `/api/messages/{mid}/cancel` | — | `{ ok: true }`；已生成正文保留，未校验引用标为推断 |
| POST | `/api/messages/{mid}/regenerate` | — | 事件流；新回答是原回答的兄弟节点，同时更新 `active_leaf_id` |

- `client_msg_id`：前端生成的 UUID。同一个 id 重复提交返回同一条消息的事件流，不新建消息。
- `Scope = { mode: "all" | "selected" | "none", document_ids?: string[] }`。`all`＝本项目全部已解析材料；`selected`＝只用输入框里 @ 引用的文件；`none`＝不检索材料。

## 分支

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/branches` | `{ conversation_id, fork_message_id, anchor: { start, end, quote } }` | `Branch` |
| POST | `/api/branches/{bid}/merge` | — | `{ branch: Branch, merge_note: Message }` |
| PUT | `/api/branches/{bid}` | `{ status: "archived" }` 或 `{ title }` | `Branch` |

`Branch = {id, conversation_id, fork_message_id, anchor_start, anchor_end, anchor_quote, title, status: "open"|"merged"|"archived", merged_into_message_id?, created_at, context_turns}`。`context_turns`＝分支能看到的主线轮数，供“上下文：主线前 N 轮 + 本分支”提示使用。

`anchor.start/end` 是相对 fork 消息 `content` **去掉 `[[E#]]` 标记后的纯文本**的字符偏移。

## 材料与证据

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/projects/{pid}/documents` | — | `{ groups: { kind, documents: Document[] }[] }`，分组顺序 pdf、pptx、code+ipynb、md、web |
| POST | `/api/projects/{pid}/documents` | multipart `file`（可多个） | `{ documents: Document[], job_ids: string[] }` |
| GET | `/api/documents/{did}` | — | `Document` |
| GET | `/api/documents/{did}/raw` | — | 原文件；PPTX 返回转换后的 PDF；code/md 返回 `text/plain` |
| POST | `/api/documents/{did}/reparse` | — | `{ job_id }` |
| GET | `/api/evidence/{eid}` | — | `Evidence`（见 [evidence-locator.md](./evidence-locator.md)）＋ `cited_by: {message_id, label}[]`；`source_type=message` 时另带 `context_messages: Message[]`（被引消息前后各 1 条，按路径可见性过滤） |
| GET | `/api/web_snapshots/{sid}` | — | `{id, url, title, fetched_at, text, sha256, http_status}` |

`Document = {id, project_id, kind: "pdf"|"pptx"|"code"|"ipynb"|"md"|"web", title, pages?, lines?, parse_status: "queued"|"parsing"|"ready"|"failed", progress: 0-100, parse_error?, cited_count, created_at}`

## 市场、插件与 Skill

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/market/plugins` | — | `{ items: MarketItem[] }` |
| GET | `/api/market/skills` | — | `{ items: MarketItem[] }` |
| GET | `/api/plugins` | — | `{ plugins: InstalledPlugin[] }` |
| GET | `/api/plugins/{id}` | — | `InstalledPlugin & { tools: {name, description}[] }`；未安装时返回市场 manifest 与上游工具清单 |
| POST | `/api/plugins/{id}` | `{ config: Record<string,string> }` | `InstalledPlugin`；内部完成启动与 `tools/list` 自检，失败返回 `PLUGIN_SELF_CHECK_FAILED` 并附 `log_tail` |
| DELETE | `/api/plugins/{id}` | — | `{ ok: true }` |
| GET | `/api/conversations/{cid}/plugins` | — | `{ plugins: {plugin_id, enabled, status, reason?}[] }` |
| PUT | `/api/conversations/{cid}/plugins` | `{ enabled_plugin_ids: string[] }` | 同上 |
| GET | `/api/skills` | — | `{ skills: Skill[] }` |
| GET | `/api/skills/{id}` | — | `Skill & { skill_md: string, files: string[] }` |
| POST | `/api/skills/import` | `{ source: "github" \| "local", url?, path? }` | `Skill`；`SKILL.md` 头部缺 `name`/`description` 返回 `SKILL_INVALID` |
| PUT | `/api/skills/{id}` | `{ enabled }` | `Skill` |

`MarketItem = {id, type: "plugin"|"skill", name, owner, official, stars, stars_date, license, category, desc_zh, repo_url, installed}`

`InstalledPlugin = {id, name, version, status: "installed"|"error"|"disabled", permissions: string[], config_schema, last_check_at}`

`Skill = {id, name, description, dir_path, source_url?, license?, enabled}`

## 设置与记忆

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/settings` | — | `Settings` |
| PUT | `/api/settings` | `Partial<Settings>` | `Settings` |
| GET | `/api/memory/items?scope=&q=&status=active` | — | `{ items: MemoryItem[] }` |
| PUT | `/api/memory/items/{id}` | `{ content }` | `MemoryItem` |
| DELETE | `/api/memory/items/{id}` | — | `{ ok: true }`；条目进屏蔽列表，不会被重新抽取 |
| GET | `/api/memory/summary` | — | `{ content, version, updated_at }` |

`Settings = {chat_model, small_model, embedding_model, api_base, api_key_set: bool, web_search_default: bool, memory_enabled: bool}`。API Key 只写不读：`PUT` 可带 `api_key`，`GET` 只返回 `api_key_set`。

立项稿 §6.3 只写了 `/api/settings` 并提到“记忆条目的查看与删除也在这里”；`/api/memory/*` 是本草案为“设置 → 记忆”补的拆分，待确认。

## 错误码

| code | HTTP | 含义 | retriable |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | 请求字段不合法 | false |
| `NOT_FOUND` | 404 | 资源不存在 | false |
| `NOT_VISIBLE_ON_PATH` | 403 | 访问当前分支路径以外的消息或快照 | false |
| `DUPLICATE_CLIENT_MSG` | 200 | 不是错误：重复的 `client_msg_id`，直接返回原事件流 | — |
| `PARSE_FAILED` | 422 | 文件解析失败（加密 PDF、扫描件无文字层等），`message` 给原因 | true |
| `MODEL_UNAVAILABLE` | 502 | 模型接口不可用或未配置 Key | true |
| `PLUGIN_SELF_CHECK_FAILED` | 502 | 插件启动或 `tools/list` 失败 | true |
| `PLUGIN_TIMEOUT` | 504 | 单次工具调用超过 30 s | true |
| `SKILL_INVALID` | 422 | SKILL.md 缺必需字段 | false |
| `INTERNAL` | 500 | 其他 | true |
