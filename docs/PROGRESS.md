# 进度看板

最后更新：2026-11-22。仓库只在云电脑本地，未推送远端。规格为草案；契约为 v0.2 草案（编排 Agent 决定，待用户追认）。

## 里程碑

| 里程碑 | 内容 | 依赖 | 状态 | 认领（分支 · 日期） |
|---|---|---|---|---|
| F0 | 契约 fixtures、`web/` 脚手架、tokens、MSW、类型、store 骨架 | 契约 v1.0 确认（用户已同意按 v0.1 草案开工） | 完成（待编排 Agent 验收与合并） | feat/F0-scaffold · 2026-11-22 |
| F1 | 外壳、拖拽与收起、项目栏、文件栏 | F0 | 完成（待编排 Agent 验收与合并；U19–U23 待确认） | feat/F1-shell（worktree `worktrees/F1-shell`，端口 5171）· 2026-11-23 |
| F2 | 主页、卡片与动效、卡片弹窗 | F0 | 部分完成（待编排 Agent 验收；剩余：试一试上传示例材料等 U8，首次打开弹窗偶发长任务见 U27） | feat/F2-home · 2026-11-22 |
| F3 | 输入框、对话流、SSE 客户端、证据胶囊、步骤行、来源列表 | F0、F1 | 未开始 | |
| F4 | 右栏标签、PDF/PPT/代码/网页/历史对话预览、证据栏 | F3 | 未开始 | |
| F5 | 划词工具条、分支面板、分支标记、合并卡片 | F3、F4 | 未开始 | |
| F6 | 市场页、插件/Skill 详情、安装弹窗、会话插件弹层、设置与记忆页 | F1、F3 | 未开始 | |
| B1 | 数据库、上传与解析、混合检索 | F 系列完成 | 未开始 | |
| B2 | Agent 主回路、SSE、引用校验、续流与取消 | B1 | 未开始 | |
| B3 | 长程记忆、分支可见性、插件运行时（ArXiv、Fetch）、Skill 加载 | B2 | 未开始 | |
| E1 | LongMemEval 数据准备、BranchMem 生成 | B1 | 未开始 | |
| E2 | 跑分、判分、指标、消融 | B3、E1 | 未开始 | |

F2 与 F1 可并行；F6 的市场部分可与 F4/F5 并行。

## 共享文件锁

| 文件 | 当前持有分支 | 自 |
|---|---|---|
| `docs/contract/*`（含 fixtures）、`docs/ux/state.md`、`web/src/api/types.ts`、`web/src/store/*`、`web/src/styles/tokens.css` | feat/F0-scaffold（合并进 main 后释放） | 2026-11-22 |

## 已定决定

| 日期 | 决定 | 来源 |
|---|---|---|
| 2026-11-21 | 产品名 Mnemosyne | 用户 |
| 2026-11-21 | 左侧栏删除“搜索”“长期记忆”；界面不刻意强调记忆 | 用户 |
| 2026-11-21 | 市场分插件市场与 Skill 市场，条目取自 GitHub 真实项目 | 用户 |
| 2026-11-21 | 先前端后后端 | 用户 |
| 2026-11-21 | 右栏只预览不编辑 | 用户 |
| 2026-11-22 | README、agent 用 UX 规格（每个按钮/窗口/模块一份）、开发提示词 | 用户 |
| 2026-11-22 | 暂不推送 GitHub，仓库只保存在云电脑本地 | 用户 |
| 2026-11-22 | 契约 v0.2（原未决 U11）：`Document` 加 `group: paper\|slides\|code\|notes\|web`，文件栏与 `GET /documents` 按 group 分组，顺序 paper、slides、code、notes、web；横版 PDF 判为 slides | 编排 Agent 决定，待用户追认 |
| 2026-11-22 | 契约 v0.2（原 U12）：SSE `evidence` 事件加 `source_id`、`sha256?`，`eid` 即 `Evidence.id`；`streaming.evidence` 存 `Evidence[]` | 编排 Agent 决定，待用户追认 |
| 2026-11-22 | state.md（原 U13）：补 `useUI.openModal/closeModal/pushToast/dismissToast`、`Toast.action={label,onClick}`、`useChat.setProject/setConversation/setActiveBranch`、`useLayout.setView/setMarketRoute` | 编排 Agent 决定，待用户追认 |
| 2026-11-22 | state.md（原 U14）：`mn.layout.v1` 只持久化 `sizes`、`collapsed` | 编排 Agent 决定，待用户追认 |
| 2026-11-22 | 契约 v0.2（原 U15）：rest-api 补 `PluginDetail.verified`；未安装插件返回 `PluginDetail`、`status=not_installed`；错误体加 `details?`（自检失败放 `details.log_tail`）；插件 id 用 manifest id、Skill id 用 name，不加前缀 | 编排 Agent 决定，待用户追认 |
| 2026-11-22 | 契约 v0.2（原 U16）：所有字符偏移左闭右开、按 Unicode 码点计数，前端负责与 UTF-16 换算（F3 实现）；代码行号 `lines` 为从 1 开始的闭区间 | 编排 Agent 决定，待用户追认 |
| 2026-11-22 | 契约 v0.2（原 U17）：regenerate 的 `message.start` 用原用户消息的 `user_message_id` 与 `client_msg_id`；`context_messages` 含被引消息本身及前后各 1 条（最多 3 条） | 编排 Agent 决定，待用户追认 |
| 2026-11-22 | 契约 v0.2（原 U18）：`Document` 加 `cells?`（ipynb）、`snapshot_id?`（kind=web）；每个网页快照在文件栏以一条 `kind=web, group=web` 的 Document 呈现 | 编排 Agent 决定，待用户追认 |

## 未决（需要用户拍板）

| # | 问题 | 影响 | 提出 |
|---|---|---|---|
| U1 | 课程截止日期与论文形式 | 排期 | 立项稿 §15 |
| U2 | 模型选择与评测预算上限 | B2、E2 | 立项稿 §15 |
| U3 | 是否加跑 LoCoMo | E2 | 立项稿 §15 |
| U4 | Skill 附带脚本是否执行（现方案：不执行） | B3 | 立项稿 §15 |
| U5 | 契约草案补充的接口是否接受：`/api/memory/*`、`X-Model-Tier`、`active_leaf`、`context_messages`、`client_msg_id` | F3、F6、B2 | 2026-11-22 |
| U6 | 网页快照用纯文本渲染（立项稿写的是沙箱 iframe） | F4 | 2026-11-22 |
| U7 | 无概念图的界面（设置弹窗、记忆页、安装弹窗、收起态竖条、引用范围胶囊等，见页面地图“缺口”表）先补图还是实现后截图确认 | F1、F3、F6 | 2026-11-22 |
| U8 | “试一试”示例材料：论文、代码、课件各用哪份 | F2 | 2026-11-22 |
| U9 | 用户卡片显示名是否加 `display_name` 设置项 | F1 | 2026-11-22 |
| U10 | License | 仓库 | 2026-11-22 |
| U19 | 分栏没用 react-resizable-panels（v2 只支持百分比，state.md 按 px 定宽度与上下限），改为自写 px 布局 + 指针拖拽；依赖未删。是否接受、是否从 package.json 移除 | F1、F4 | 2026-11-23 |
| U20 | ⌘/Ctrl+1、Ctrl+2 在 Windows/Linux 的 Chrome 里是切换浏览器标签，页面拦不到（Mac 的 ⌘1 同理）；是否换成 ⌘/Ctrl+Shift+1/2 或 Alt+1/2 | F1 | 2026-11-23 |
| U21 | 对话标题为空时规格要显示首条用户消息前 20 字，但 `ConversationSummary` 不含消息内容；现显示“新对话”。是否给列表接口加 `preview` 或由后端保证 title 非空 | F1、B1 | 2026-11-23 |
| U22 | 1440 宽时四栏默认宽 252+236+560 放不下对话栏 480，现由右栏让位到 432（拖右栏最小 400）；左两栏只能再拉宽 32 px。是否接受，或把右栏默认宽改小 | F1、F4 | 2026-11-23 |
| U23 | 新建对话后“输入框获得焦点”、文件行拖到输入框的接收，依赖 F2/F3 的输入框；F1 只负责切到主页与 `application/x-mn-document` 拖拽数据 | F2、F3 | 2026-11-23 |
| U24 | 主页输入框占位文案冲突：规格 1-外壳-输入框「状态」写“问点什么，或拖入论文、课件、代码”，UI-01 写“提一个问题，或拖入论文、代码、课件；/ 调用插件，@ 引用文件与笔记”。F2 外壳按规格；定下后 F3 统一 | F2、F3 | 2026-11-22 |
| U25 | `useChat` 没有改输入框草稿的 action（state.md 只列 `composer` 字段）。“试一试”暂用 `useChat.setState` 写 `composer.main.text`（`web/src/home/draft.ts`）。建议 F3 在 state.md 与 chat.ts 加 `setDraft(key, patch)`，再把 draft.ts 改为调用它 | F2、F3 | 2026-11-22 |
| U26 | 卡片弹窗右上 × 与遮罩没有规格 ID，现用派生 testid `home.card-modal-close`、`home.card-modal-scrim`；“试一试”后焦点放到主页输入框（规格未写）。是否接受，或在 specs_*.py 补 ID | F2 | 2026-11-22 |
| U27 | 长任务验收：预热后的悬停/弹窗/切换/关闭在 dev 与生产构建下均无 >50 ms 长任务；但页面加载后**第一次**打开弹窗，在云电脑 headless Chromium（软件渲染）生产构建 11 轮中 4 轮出现一条 55–75 ms 长任务。未在有 GPU 的真机 Chrome 性能面板复测。是否以真机复测为准，或要求做首开预热 | F2 | 2026-11-22 |

## 动作日志

- 2026-11-23 · [编排] 合并 F1+F2 · 集成中 · 分支 integ/F1F2 · 冲突已解（tokens 合并，F2 遮罩改名 --scrim-frost；CenterPane 接入 Onboard；App/f0 测试取 F1 版本）· check 通过 · 单测 242/242 · e2e 31/38（f2-home 6 条、f1-shell 焦点 1 条在四栏外壳里失败，交 F2 修）
- 2026-11-23 · [F1] 外壳、项目栏、文件栏 · 完成 · 分支 feat/F1-shell · npm run check 通过 · 单测 225/225（含 F0）· e2e 28/28（workers=2，含 F0 的 3 条）· 左两栏与 UI-05 概念图 HTML 逐元素对位最大偏差 2 px · 截图 web/tests/screenshots/ 下 22 份规格各 1 张 + `1-启动-应用外壳@1680x1050.png` · 共享文件只追加：tokens.css、tailwind.config.ts、mocks/handlers.ts（`getMockScenario`）；store/api/契约未改 · 未决 U19–U23
- 2026-11-23 · [F1] 外壳、项目栏、文件栏 · 开始 · 分支 feat/F1-shell（worktree `INFO5000项目/worktrees/F1-shell`，dev 端口 5171）
- 2026-11-22 14:05 · [F2] 主页与能力卡片（1-新建对话-主页、1-主页-能力卡片组、1-能力卡片组-单张卡片、2-能力卡片-卡片介绍弹窗、2-卡片介绍弹窗-试一试按钮、2-卡片介绍弹窗-知道了按钮） · 部分完成（试一试未上传示例材料，待 U8；首次打开弹窗偶发长任务，见 U27；新增未决 U24–U27） · 分支 feat/F2-home · npm run check 通过 · 单测 168/168（F2 17 条 + App 2 条）· e2e 13/13（F2 10 + F0 3，`npx playwright test -c tests/playwright.f2.config.ts --workers=2`）· 截图 web/tests/screenshots/1-新建对话-主页.png 等 8 张
- 2026-11-22 · [F2] 主页与能力卡片 · 开始 · 分支 feat/F2-home（worktree `INFO5000项目/worktrees/F2-home`，dev 端口 5172）
- 2026-11-22 21:06 · [F0] 契约 fixtures 与前端脚手架 · 完成 · 分支 feat/F0-scaffold · npm run check 通过（84 份 fixture、38/38 接口）· 单测 150/150 · e2e 3/3 · 截图 web/tests/screenshots/F0-占位页-tokens.png
- 2026-11-22 21:06 · [F0] 契约 · 契约变更 v0.2 · 编排 Agent 决定，待用户追认：rest-api.md、sse-events.md、types.ts、data-model.md、evidence-locator.md、contract/README.md、ux/state.md 按 U11–U18 修改；规格源 specs_a.py（文件栏按 group 分组、网页来源行用 `snapshot_id`）已重新生成；fixtures 重新生成
- 2026-11-22 21:00 · [F0] 契约 fixtures 与前端脚手架 · 阻塞（交付物已全部完成并本地提交；契约/状态约定 U11–U18 待用户确认，确认后改 `web/src/mocks/fixtures-source.ts` 重新生成即可） · 分支 feat/F0-scaffold · npm run check 通过（83 份 fixture、38/38 接口）· 单测 144/144 · e2e 3/3 · 截图 web/tests/screenshots/F0-占位页-tokens.png
- 2026-11-22 · [F0] 契约 fixtures 与前端脚手架 · 开始 · 分支 feat/F0-scaffold（worktree `INFO5000项目/worktrees/F0-scaffold`）
- 2026-11-22 17:20 · 文档 · 重写 AGENTS.md（读文件顺序、目录与修改权限、冲突优先级、红线 R1–R8、停下询问的情况）；提示词改为指向云电脑本地仓库；规定暂不推送
- 2026-11-22 · 文档 · 初始化 README、AGENTS.md、开发规范、契约 v0.1 草案、88 份 UX 规格、开发提示词 · 未写代码
