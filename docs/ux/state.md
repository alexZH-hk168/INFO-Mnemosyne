# 前端状态与数据获取约定

UX 规格里“store”与“query”两列引用的名字都在这里定义。组件只能通过这里列出的 store action 改界面状态，通过列出的 query key 读服务端数据。新增字段先改本文件。

## Zustand stores（`web/src/store/`）

### `useLayout`（`layout.ts`，持久化到 localStorage 键 `mn.layout.v1`，只存 `sizes` 与 `collapsed`；右栏标签、`view`、`marketRoute` 随路由和数据恢复）

| 字段 / action | 类型 | 说明 |
|---|---|---|
| `sizes` | `[number, number, number, number]` | 四栏宽度（px），顺序：项目栏、文件栏、对话栏、右栏 |
| `collapsed` | `[boolean, boolean, boolean, boolean]` | 各栏是否收起；对话栏不可收起，恒为 false |
| `setSize(i, px)` | | 受最小/最大宽度约束 |
| `resetSize(i)` | | 恢复默认宽度（双击拖拽条） |
| `toggle(i)` | | 收起/展开第 i 栏 |
| `rightTabs` | `Tab[]` | 右栏标签：`{id, kind: 'branch'\|'pdf'\|'pptx'\|'code'\|'md'\|'web'\|'message'\|'plugin', ref_id, title}` |
| `activeTab` | `string \| null` | |
| `openTab(tab)` / `closeTab(id)` / `activateTab(id)` | | 同一 `kind+ref_id` 已存在则激活不重复开；打开时右栏若收起则自动展开 |
| `view` | `'home' \| 'conversation' \| 'market'` | 中间区域显示什么 |
| `setView(view)` | | 切换中间区 |
| `marketRoute` | `{tab: 'plugins'\|'skills'\|'installed', detail?: {type, id}}` | |
| `setMarketRoute(route)` | | 整体替换 `marketRoute` |

默认宽度与限制：项目栏 252（200–360），文件栏 236（200–340），对话栏弹性（≥ 480），右栏 560（400 – 视口 55%）。收起后为 44 px 竖条。

### `useChat`（`chat.ts`）

| 字段 / action | 说明 |
|---|---|
| `projectId`, `conversationId`, `activeBranchId` | 当前上下文；`activeBranchId=null` 表示主线 |
| `setProject(id)` | 设当前项目（只改 `projectId`） |
| `setConversation(id \| null)` | 设当前对话；同时把 `activeBranchId` 置回 `null`（回到主线）。路由 `/c/:cid/b/:bid` 先调它再调 `setActiveBranch` |
| `setActiveBranch(id \| null)` | 切换当前分支；`null` 为主线 |
| `streaming` | `{message_id, client_msg_id, last_seq, steps: Step[], evidence: Evidence[], text, citations: Citation[], status: 'streaming'\|'verifying'\|'saved'\|'cancelled'\|'error'} \| null`；`evidence` 由 SSE `evidence` 事件转换而来（`eid` → `id`，其余同名字段照拷） |
| `composer` | `{text, web_search, scope: Scope, forced_skill?: string, attachments: ID[]}`；主线与每个分支各有一份草稿，按 `branchId ?? 'main'` 存 |
| `send(target)` | 生成 `client_msg_id`，调 `POST /messages`，交给 SSE 客户端 |
| `cancel()` | `POST /messages/{mid}/cancel` |
| `applyEvent(e: SseEvent)` | SSE 客户端唯一的写入口 |

### `useEvidence`（`evidence.ts`）

| 字段 / action | 说明 |
|---|---|
| `selectedEvidenceId` | 当前在右栏定位的证据 |
| `messageEvidence` | 当前回答的证据 id 列表（证据栏左右切换用） |
| `select(eid, messageId)` | 设置选中并调用 `useLayout.openTab` 打开对应预览 |
| `hover` | `{eid, rect} \| null`，悬停浮层用 |

### `useUI`（`ui.ts`）

| 字段 / action | 说明 |
|---|---|
| `modal` | `{kind: 'card-intro'\|'new-project'\|'install'\|'settings', props?} \| null` |
| `openModal(kind, props?)` / `closeModal()` | 同一时间只有一个弹窗，再次 `openModal` 会替换 |
| `toasts` | `Toast[]`，`Toast = {id, kind: 'info'\|'success'\|'error', text, action?: {label, onClick}}` |
| `pushToast({kind, text, action?})` | 追加一条提示并返回生成的 `id`；自动消失的时长由 1-外壳-全局提示规定 |
| `dismissToast(id)` | 移除一条提示 |
| `popover` | `'plugins'\|'slash'\|'mention'\|'scope'\|null` |
| `selection` | `{message_id, start, end, quote, rect} \| null`；`start/end` 与分支锚点同坐标（左闭右开、按码点） |

## TanStack Query keys（`web/src/api/queries.ts`）

| key | 接口 |
|---|---|
| `['projects']` | GET `/api/projects` |
| `['conversations', pid]` | GET `/api/projects/{pid}/conversations`（infinite） |
| `['tree', cid]` | GET `/api/conversations/{cid}/tree` |
| `['documents', pid]` | GET `/api/projects/{pid}/documents`；有 `parsing/queued` 时每 2 s 轮询 |
| `['document', did]` | GET `/api/documents/{did}` |
| `['evidence', eid]` | GET `/api/evidence/{eid}` |
| `['snapshot', sid]` | GET `/api/web_snapshots/{sid}` |
| `['market', 'plugins' \| 'skills']` | GET `/api/market/*` |
| `['plugins']`, `['plugin', id]` | GET `/api/plugins`, `/api/plugins/{id}` |
| `['skills']`, `['skill', id]` | GET `/api/skills`, `/api/skills/{id}` |
| `['convPlugins', cid]` | GET `/api/conversations/{cid}/plugins` |
| `['settings']`, `['memory', filters]`, `['memorySummary']` | 设置与记忆 |

写操作用 `useMutation`，成功后失效对应 key（每份规格的“接口”表写明失效哪些 key）。

## data-testid

每份规格的 ID 即 `data-testid`（如 `chat.evidence-chip`）。列表项追加 `:{id}`，如 `sidebar.conversation-row:cnv_123`。Playwright 测试只用 testid 定位。
