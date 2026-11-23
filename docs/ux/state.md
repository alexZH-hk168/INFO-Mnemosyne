# 前端状态与数据获取约定

UX 规格里“store”与“query”两列引用的名字都在这里定义。组件只能通过这里列出的 store action 改界面状态，通过列出的 query key 读服务端数据。新增字段先改本文件。

## Zustand stores（`web/src/store/`）

### `useLayout`（`layout.ts`，持久化到 localStorage 键 `mn.layout.v1`，只存 `sizes` 与 `collapsed`；右栏标签、`view`、`marketRoute` 随路由和数据恢复）

| 字段 / action                                       | 类型                                                           | 说明                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `sizes`                                             | `[number, number, number, number]`                             | 四栏宽度（px），顺序：项目栏、文件栏、对话栏、右栏                                                       |
| `collapsed`                                         | `[boolean, boolean, boolean, boolean]`                         | 各栏是否收起；对话栏不可收起，恒为 false                                                                 |
| `setSize(i, px)`                                    |                                                                | 受最小/最大宽度约束                                                                                      |
| `resetSize(i)`                                      |                                                                | 恢复默认宽度（双击拖拽条）                                                                               |
| `toggle(i)`                                         |                                                                | 收起/展开第 i 栏                                                                                         |
| `rightTabs`                                         | `Tab[]`                                                        | 右栏标签：`{id, kind: 'branch'\|'pdf'\|'pptx'\|'code'\|'md'\|'web'\|'message'\|'plugin', ref_id, title}` |
| `activeTab`                                         | `string \| null`                                               |                                                                                                          |
| `openTab(tab)` / `closeTab(id)` / `activateTab(id)` |                                                                | 同一 `kind+ref_id` 已存在则激活不重复开；打开时右栏若收起则自动展开                                      |
| `view`                                              | `'home' \| 'conversation' \| 'market'`                         | 中间区域显示什么                                                                                         |
| `setView(view)`                                     |                                                                | 切换中间区                                                                                               |
| `marketRoute`                                       | `{tab: 'plugins'\|'skills'\|'installed', detail?: {type, id}}` |                                                                                                          |
| `setMarketRoute(route)`                             |                                                                | 整体替换 `marketRoute`                                                                                   |

默认宽度与限制：项目栏 252（200–360），文件栏 236（200–340），对话栏弹性（≥ 480），右栏 560（400 – 视口 55%）。收起后为 44 px 竖条。

### `useChat`（`chat.ts`）

| 字段 / action                                                 | 说明                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`, `conversationId`, `activeBranchId`               | 当前上下文；`activeBranchId=null` 表示主线                                                                                                                                                                                                                                                                                                                                                                      |
| `setProject(id)`                                              | 设当前项目（只改 `projectId`）                                                                                                                                                                                                                                                                                                                                                                                  |
| `setConversation(id \| null)`                                 | 设当前对话；同时把 `activeBranchId` 置回 `null`（回到主线）。路由 `/c/:cid/b/:bid` 先调它再调 `setActiveBranch`                                                                                                                                                                                                                                                                                                 |
| `setActiveBranch(id \| null)`                                 | 切换当前分支；`null` 为主线                                                                                                                                                                                                                                                                                                                                                                                     |
| `streaming`                                                   | `{message_id, client_msg_id, last_seq, steps: Step[], evidence: Evidence[], text, citations: Citation[], status: 'streaming'\|'verifying'\|'saved'\|'cancelled'\|'error'} \| null`；`evidence` 由 SSE `evidence` 事件转换而来（`eid` → `id`，其余同名字段照拷）                                                                                                                                                 |
| `composer`                                                    | `{text, web_search, scope: Scope, forced_skill?: string, attachments: ID[]}`；主线与每个分支各有一份草稿。key 见 `draftKey`（编排决定 U37，替代原来的 `branchId ?? 'main'`）：分支用 `branchId`，主线按对话存 `${conversationId}:main`，还没有对话 id 的主页用 `new:main`                                                                                                                                       |
| `send(target)`                                                | 生成 `client_msg_id`，调 `POST /messages`，交给 SSE 客户端                                                                                                                                                                                                                                                                                                                                                      |
| `cancel()`                                                    | `POST /messages/{mid}/cancel`                                                                                                                                                                                                                                                                                                                                                                                   |
| `applyEvent(e: SseEvent)`                                     | SSE 客户端唯一的写入口                                                                                                                                                                                                                                                                                                                                                                                          |
| `setDraft(key, patch)`                                        | （F3 追加，编排决定 U25）合并修改 `composer[key]`；`key` 由 `draftKey(conversationId, branchId)` 得到（U37），不存在时以空草稿为底                                                                                                                                                                                                                                                                              |
| `turn`                                                        | （F3 追加）进行中/刚结束的一轮：`{kind: 'send'\|'regenerate', conversation_id, client_msg_id, content, parent_id?, branch_id?, regenerate_of?, user_message_id?, connection: 'live'\|'reconnecting'\|'lost', error?: {code, message, retriable}, latency_ms?} \| null`。发送后立即建立（乐观插入用户消息），`message.start` 补 `user_message_id`；SSE 事件只经 `applyEvent` 写入，连接状态由 SSE 客户端回调写入 |
| `regenerate(mid, {conversation_id, parent_id?, model_tier?})` | （F3 追加）`POST /api/messages/{mid}/regenerate`，交给 SSE 客户端                                                                                                                                                                                                                                                                                                                                               |
| `settleTurn()`                                                | （F3 追加）对话栏确认 `['tree', cid]` 已含本轮消息后调用，去掉乐观显示；`streaming` 保留供证据定位                                                                                                                                                                                                                                                                                                              |
| `send(target)` 的 `target.model_tier?: 'high'\|'fast'`        | （F3 追加）模型档位，有值时请求头带 `X-Model-Tier: high\|fast`（规格 1-输入框-模型档位；契约未列该请求头，见 PROGRESS 未决 U5）                                                                                                                                                                                                                                                                                 |
| `draftKey(conversationId, branchId?)`、`NEW_MAIN`             | （F3 追加，U37）草稿 key：`branchId` → 分支；否则 `${conversationId}:main`；都没有 → `NEW_MAIN = 'new:main'`。`MAIN = 'main'` 保留导出但不再用作草稿 key                                                                                                                                                                                                                                                        |
| `send(target)` 的 `target.draft_key?`                         | （F3 追加，U37）从哪份草稿取内容，缺省 `draftKey(conversation_id, branch_id)`；主页发送传 `NEW_MAIN`，发出后丢弃 `new:main`，联网开关与“不用材料”范围带到 `${cid}:main`                                                                                                                                                                                                                                         |
| `streaming.started_at?`、`streaming.latency_ms?`              | （F3 追加，U35）整轮耗时：取 `message.end.latency_ms`；以 `error` 结束（没有 `message.end`）时为收到 `error` 的本地时刻减 `started_at`（收到 `message.start` 的本地时刻）                                                                                                                                                                                                                                       |

### `useEvidence`（`evidence.ts`）

| 字段 / action                   | 说明                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `selectedEvidenceId`            | 当前在右栏定位的证据                                                                                                                                                           |
| `messageEvidence`               | 当前回答的证据 id 列表（证据栏左右切换用）                                                                                                                                     |
| `select(eid, messageId)`        | 设置选中并调用 `useLayout.openTab` 打开对应预览                                                                                                                                |
| `hover`                         | `{eid, rect} \| null`，悬停浮层用                                                                                                                                              |
| `selectedMessageId`             | （F4 追加）当前证据是从哪条回答打开的（证据栏“被主线第 N 条回答引用”与左右切换用）                                                                                             |
| `select(eid, messageId, opts?)` | （F4 追加可选参数）`opts.evidence`：历史消息的证据不在流式池里时由调用方传入，用来打开对应标签；`opts.evidenceIds`：本回答的证据顺序，缺省沿用流式池顺序（池为空时为 `[eid]`） |
| `setMessageEvidence(ids)`       | （F4 追加）证据栏按回答的引用（去掉 removed、同一证据只算一次、按序号）算出列表后写回                                                                                          |
| `selectedLeafId`                | （F5 追加，契约 v0.4 / U44）当前证据从分支面板打开时为该分支当前叶子消息 id，右栏读证据与网页快照时带 `?leaf_id=`；主线打开时为 `null`（不带，后端按 `active_leaf_id`） |
| `select(…, opts.leafId?)`       | （F5 追加可选字段）写入 `selectedLeafId`；缺省为 `null`                                                                                                                         |

分支里的叶子由 `web/src/branch/leafContext.ts` 的 `LeafContext` 下发（F5）：分支面板与合并卡片展开时提供分支最后一条消息 id（还没有消息时为 fork 消息），证据胶囊、悬停浮层、来源列表、步骤行读取并随 `select` 传入。

`useLayout.openTab` （F4 追加，规格 1-右栏-标签条）：右栏最多 `MAX_TABS = 8` 个标签，超出时关闭最早的、未激活的非分支标签。

### `useUI`（`ui.ts`）

| 字段 / action                              | 说明                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `modal`                                    | `{kind: 'card-intro'\|'new-project'\|'install'\|'settings', props?} \| null`                      |
| `openModal(kind, props?)` / `closeModal()` | 同一时间只有一个弹窗，再次 `openModal` 会替换                                                     |
| `toasts`                                   | `Toast[]`，`Toast = {id, kind: 'info'\|'success'\|'error', text, action?: {label, onClick}}`      |
| `pushToast({kind, text, action?})`         | 追加一条提示并返回生成的 `id`；自动消失的时长由 1-外壳-全局提示规定                               |
| `dismissToast(id)`                         | 移除一条提示                                                                                      |
| `popover`                                  | `'plugins'\|'slash'\|'mention'\|'scope'\|null`                                                    |
| `selection`                                | `{message_id, start, end, quote, rect} \| null`；`start/end` 与分支锚点同坐标（左闭右开、按码点） |

## TanStack Query keys（`web/src/api/queries.ts`）

| key                                                        | 接口                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `['projects']`                                             | GET `/api/projects`                                                    |
| `['conversations', pid]`                                   | GET `/api/projects/{pid}/conversations`（infinite）                    |
| `['tree', cid]`                                            | GET `/api/conversations/{cid}/tree`                                    |
| `['documents', pid]`                                       | GET `/api/projects/{pid}/documents`；有 `parsing/queued` 时每 2 s 轮询 |
| `['document', did]`                                        | GET `/api/documents/{did}`                                             |
| `['evidence', eid]`                                        | GET `/api/evidence/{eid}`                                              |
| `['evidence', eid, {leaf_id}]`、`['snapshot', sid, {leaf_id}]` | （F5 追加，`queryKeys.evidenceAt / snapshotAt`）分支里按叶子判断可见性：GET `…?leaf_id=`；前缀与不带 leaf 的 key 相同，失效时一起失效 |
| `['snapshot', sid]`                                        | GET `/api/web_snapshots/{sid}`                                         |
| `['market', 'plugins' \| 'skills']`                        | GET `/api/market/*`                                                    |
| `['plugins']`, `['plugin', id]`                            | GET `/api/plugins`, `/api/plugins/{id}`                                |
| `['skills']`, `['skill', id]`                              | GET `/api/skills`, `/api/skills/{id}`                                  |
| `['convPlugins', cid]`                                     | GET `/api/conversations/{cid}/plugins`                                 |
| `['settings']`, `['memory', filters]`, `['memorySummary']` | 设置与记忆                                                             |

写操作用 `useMutation`，成功后失效对应 key（每份规格的“接口”表写明失效哪些 key）。

## data-testid

每份规格的 ID 即 `data-testid`（如 `chat.evidence-chip`）。列表项追加 `:{id}`，如 `sidebar.conversation-row:cnv_123`。Playwright 测试只用 testid 定位。
