# REST 接口

前缀 `/api`。除上传外请求体为 JSON。响应结构中带 `?` 的字段可为空。立项稿只定义了路径与部分请求体，响应结构为本草案补充（v0.1）；v0.2 的改动见各节“v0.2”标注与 [README](./README.md#版本记录)。

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

`anchor.start/end` 是相对 fork 消息 `content` **去掉 `[[E#]]` 标记后的纯文本**的字符偏移，左闭右开、按 Unicode 码点计数（见 [README 第 7 条](./README.md#规则)）。

## 材料与证据

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/projects/{pid}/documents` | — | `{ groups: { group, documents: Document[] }[] }`，按 `Document.group` 分组，顺序 paper、slides、code、notes、web；空组不返回（v0.2） |
| POST | `/api/projects/{pid}/documents` | multipart `file`（可多个） | `{ documents: Document[], job_ids: string[] }` |
| GET | `/api/documents/{did}` | — | `Document` |
| GET | `/api/documents/{did}/raw` | — | 原文件；PPTX 返回转换后的 PDF；code/md 返回 `text/plain` |
| POST | `/api/documents/{did}/reparse` | — | `{ job_id }` |
| GET | `/api/evidence/{eid}` | query `leaf_id?`（v0.4） | `Evidence`（见 [evidence-locator.md](./evidence-locator.md)）＋ `cited_by: {message_id, label}[]`；`source_type=message` 时另带 `context_messages: Message[]`：被引消息本身及其前后各 1 条，最多 3 条，按路径可见性过滤（v0.2） |
| GET | `/api/web_snapshots/{sid}` | query `leaf_id?`（v0.4） | `{id, url, title, fetched_at, text, sha256, http_status}` |

`Document = {id, project_id, kind: "pdf"|"pptx"|"code"|"ipynb"|"md"|"web", group: "paper"|"slides"|"code"|"notes"|"web", title, pages?, lines?, cells?, snapshot_id?, parse_status: "queued"|"parsing"|"ready"|"failed", progress: 0-100, parse_error?, cited_count, created_at}`

- `group`（v0.2）：文件栏分组。默认映射 pptx→slides；code、ipynb→code；md→notes；web→web；pdf 默认 paper，后端解析时若多数页为横向（宽 > 高）判为 slides。
- `cells`（v0.2）：仅 ipynb，单元格数。`pages` 用于 pdf/pptx，`lines` 用于 code/md。
- `snapshot_id`（v0.2）：仅 kind=web。每个网页快照在文件栏以一条 `kind=web, group=web` 的 Document 呈现：`Document.id` 独立（`doc_` 前缀），`snapshot_id` 指向 `web_snapshots.id`，`cited_count` 为被引次数。

`leaf_id`（v0.4，可选）：证据与网页快照的可见性按“叶子到根”的路径判断（[data-model.md](./data-model.md) “分支可见性”）。分支面板里打开证据时传该分支当前的叶子消息 id；不传时用所在对话的 `active_leaf_id`。规则：被判断的消息（网页/插件证据的抓取消息、历史对话证据的被引消息）与 `leaf_id` 同属一个对话时按 `leaf_id` 的路径判断，否则按那个对话自己的 `active_leaf_id` 判断；用户上传材料始终可见。`leaf_id` 不是已有消息 → `VALIDATION_ERROR`（资源不存在时仍先返回 `NOT_FOUND`）。`context_messages` 的前后消息也按同一条路径过滤。

## 市场、插件与 Skill

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/market/plugins` | — | `{ items: MarketItem[] }` |
| GET | `/api/market/skills` | — | `{ items: MarketItem[] }` |
| GET | `/api/plugins` | — | `{ plugins: InstalledPlugin[] }` |
| GET | `/api/plugins/{id}` | — | `PluginDetail = InstalledPlugin & { tools: {name, description}[], verified: bool, manifest?, about_zh?, usage_zh?, permission_notes? }`；`verified`＝是否属于 v1 完整验收的插件。未安装时同样返回 `PluginDetail`，字段取自市场 manifest 与上游工具清单，`status: "not_installed"`（v0.2）。v0.3 可选字段见下 |
| POST | `/api/plugins/{id}` | `{ config: Record<string,string> }` | `InstalledPlugin`；内部完成启动与 `tools/list` 自检，失败返回 `PLUGIN_SELF_CHECK_FAILED`，日志尾部放在错误体 `error.details.log_tail`（v0.2）。安装、改配置、“重新检查”共用此接口：`config` 中**未提供的键沿用已存值**，值为空字符串表示清除该键；`{ config: {} }` 即按已存配置重新自检（v0.3） |
| DELETE | `/api/plugins/{id}` | — | `{ ok: true }` |
| GET | `/api/conversations/{cid}/plugins` | — | `{ plugins: {plugin_id, enabled, status, reason?}[] }` |
| PUT | `/api/conversations/{cid}/plugins` | `{ enabled_plugin_ids: string[] }` | 同上 |
| GET | `/api/skills` | — | `{ skills: Skill[] }` |
| GET | `/api/skills/{id}` | — | `Skill & { skill_md: string, files: string[] }` |
| POST | `/api/skills/import` | `{ source: "github" \| "local", url?, path? }` | `Skill`；`SKILL.md` 头部缺 `name`/`description` 返回 `SKILL_INVALID` |
| PUT | `/api/skills/{id}` | `{ enabled }` | `Skill` |

`MarketItem = {id, type: "plugin"|"skill", name, owner, official, stars, stars_date, license, category, desc_zh, repo_url, installed, verified?}`；`verified?`（v0.3）：是否属于 v1 完整验收，只对插件给出，前端据此在卡片上标“未验收”。

`InstalledPlugin = {id, name, version, status: "installed"|"error"|"disabled"|"not_installed", permissions: string[], config_schema, last_check_at?}`；`not_installed` 只出现在 `GET /api/plugins/{id}` 的未安装应答中（v0.2）。

v0.3 追加的可选字段（只增不改）：

- `InstalledPlugin.config_set?: string[]`：已设置的配置键名（含密钥键名）；密钥值永不回传。`InstalledPlugin.config?: Record<string, string|number|boolean>`：已存的**非密钥**配置值。
- `PluginDetail.manifest?: {transport: "stdio"|"http", command, args: string[], tools_allow?: string[]}`：取自适配清单（[plugin-manifest.md](./plugin-manifest.md)），详情页“配置”卡显示启动命令；`tools` 中不在 `tools_allow` 里的工具标“未启用”，省略 `tools_allow`＝全部开放。
- `PluginDetail.about_zh?`：详情页简介；`usage_zh?`：“在 Mnemosyne 里怎么用”；`permission_notes?: {network?, fs_read?, fs_write?, exec?}`：每项权限的具体范围（如“访问 arXiv 与 Semantic Scholar”）。缺省时前端只显示权限名。

v0.5 草案 [B3b] 追加的可选字段（只增不改，编排统一后定稿）：

- `short_name?: string`（原 U36）：插件简称，如 `fetch`→“网页检索”、`markitdown`→“PDF 解析”、`arxiv`→“arXiv”。出现在 `MarketItem`（只对插件）、`InstalledPlugin`（因而也在 `PluginDetail`）与会话插件列表的每一项（`{plugin_id, enabled, status, reason?, short_name?}`），输入框插件胶囊直接读 `['convPlugins', cid]` 即可显示。
- 会话插件列表里 `status` 为 `error` / `disabled` 或缺必填配置的插件，`enabled` 返回 `false` 并给 `reason`（B3b 实现约定，不是新字段）。

`Skill = {id, name, description, dir_path, source_url?, license?, enabled}`

插件与 Skill 的 id 不加类型前缀（v0.2）：插件 id 即 manifest 的 `id`（如 `arxiv`，工具命名空间 `arxiv__search_papers`），Skill id 即 `SKILL.md` 的 `name`（如 `pdf`）。市场条目 `MarketItem.id` 与安装后的 id 相同。

## 设置与记忆

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/settings` | — | `Settings` |
| PUT | `/api/settings` | `Partial<Settings>` | `Settings` |
| GET | `/api/memory/items?scope=&q=&status=active` | `status`：`active`（默认）\| `superseded` \| `deleted`（v0.5 草案 [B3a]） | `{ items: MemoryItem[] }`；`MemoryItem.source_conversation_id?`（v0.3）：来源消息所在对话，“查看来源”据此跳到该对话 |
| PUT | `/api/memory/items/{id}` | `{ content }` | `MemoryItem` |
| DELETE | `/api/memory/items/{id}` | — | `{ ok: true }`；条目进屏蔽列表，不会被重新抽取 |
| GET | `/api/memory/summary` | query `project_id?`（v0.5 草案 [B3a]） | `{ content, version, updated_at }`；L4 画像按项目生成（只汇总 global 与本项目条目）。给 `project_id` 返回该项目最新版本，不给返回最近更新的一份；无画像时 `content: ""`、`version: 0`（v0.5 草案 [B3a]） |

`Settings = {chat_model, small_model, embedding_model, api_base, api_key_set: bool, web_search_default: bool, memory_enabled: bool}`。API Key 只写不读：`PUT` 可带 `api_key`，`GET` 只返回 `api_key_set`。

立项稿 §6.3 只写了 `/api/settings` 并提到“记忆条目的查看与删除也在这里”；`/api/memory/*` 是本草案为“设置 → 记忆”补的拆分，待确认。

## 错误码

错误体：`{ "error": { "code", "message", "retriable", "details"?: Record<string, unknown> } }`。`details` 可选（v0.2），放与错误相关的结构化信息，如 `PLUGIN_SELF_CHECK_FAILED` 的 `details.log_tail`（插件进程最后若干行输出，字符串）。

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
