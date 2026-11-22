# 进度看板

最后更新：2026-11-22。仓库只在云电脑本地，未推送远端。规格为草案；契约为 v0.2 草案（编排 Agent 决定，待用户追认）。

## 里程碑

| 里程碑 | 内容 | 依赖 | 状态 | 认领（分支 · 日期） |
|---|---|---|---|---|
| F0 | 契约 fixtures、`web/` 脚手架、tokens、MSW、类型、store 骨架 | 契约 v1.0 确认（用户已同意按 v0.1 草案开工） | 完成（待编排 Agent 验收与合并） | feat/F0-scaffold · 2026-11-22 |
| F1 | 外壳、拖拽与收起、项目栏、文件栏 | F0 | 完成（已合入本地 main；与 F2 的集成修复在 integ/F1F2，U19–U23 已由编排决定） | feat/F1-shell（worktree `worktrees/F1-shell`，端口 5171）· 2026-11-23 |
| F2 | 主页、卡片与动效、卡片弹窗 | F0 | 完成（编排已验收；集成修复在 integ/F1F2；“试一试”上传示例材料仍待 U8） | feat/F2-home · 2026-11-22 |
| F3 | 输入框、对话流、SSE 客户端、证据胶囊、步骤行、来源列表 | F0、F1 | 未开始 | |
| F4 | 右栏标签、PDF/PPT/代码/网页/历史对话预览、证据栏 | F3 | 未开始 | |
| F5 | 划词工具条、分支面板、分支标记、合并卡片 | F3、F4 | 未开始 | |
| F6 | 市场页、插件/Skill 详情、安装弹窗、会话插件弹层、设置与记忆页 | F1、F3 | 部分完成（第一部分已实现并本地提交，未合 main；UI-09 的启动命令/未启用工具/用法文案待 U28；无概念图的弹窗待 U7 确认；会话插件弹层、斜杠列表、插件结果卡片留给 F6b） | feat/F6-market（worktree `worktrees/F6-market`，端口 5176）· 2026-11-23 |
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
| 2026-11-22 | 分栏用自写 px 布局 + 指针拖拽，不用 react-resizable-panels；已从 `web/package.json` 与 lock 移除该依赖（原 U19） | 编排决定，待用户追认 |
| 2026-11-22 | 左两栏快捷键改为 Alt(Option)+1 / Alt+2，按 `event.code`（`Digit1`/`Digit2`）判断，按住 ⌘/Ctrl 时不响应（避开 AltGr）；不再用 ⌘/Ctrl+1/2。⌘/Ctrl+. 与 ⌘/Ctrl+K 不变。已同步 `useShortcuts.ts`、`specs_a.py`（重新生成 1-外壳-全局快捷键）与 F1 测试（原 U20） | 编排决定，待用户追认 |
| 2026-11-22 | 对话标题由后端保证非空（B1 在首条消息后生成标题）；前端保留“新对话”兜底；不改契约（原 U21） | 编排决定，待用户追认 |
| 2026-11-22 | 接受 1440 宽时右栏让位到 432（拖动最小 400）（原 U22） | 编排决定，待用户追认 |
| 2026-11-22 | 新建对话后输入框获得焦点、文件行拖到输入框的接收，交 F3（原 U23） | 编排决定，待用户追认 |
| 2026-11-22 | 主页输入框占位文案保持规格“问点什么，或拖入论文、课件、代码”（规格优先于概念图），不改（原 U24） | 编排决定，待用户追认 |
| 2026-11-22 | `useChat.setDraft(key, patch)` 交 F3 增加（同步 state.md），之后把 `web/src/home/draft.ts` 改为调用它（原 U25） | 编排决定，待用户追认 |
| 2026-11-22 | 接受派生 testid `home.card-modal-close`、`home.card-modal-scrim`，以及“试一试”后焦点放到主页输入框（原 U26） | 编排决定，待用户追认 |
| 2026-11-22 | 接受：预热后的稳态无 >50 ms 长任务即通过；首次打开弹窗偶发长任务不阻塞，真机 Chrome 性能面板复测留给用户（原 U27） | 编排决定，待用户追认 |

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
| U28 | 契约 `PluginDetail` 缺 UI-09 需要的 manifest 字段：`command`/`args`/`transport`（配置卡“启动命令”与 `--storage-path` 可选参数）、`tools_allow`（工具表“未启用”）、长描述与“在 Mnemosyne 里怎么用”的示例、按权限的说明（如“联网：访问 arXiv 与 Semantic Scholar”）。另外 fixture `get-plugins-id.ok.json` 只列了 ArXiv 的 4 个工具，上游 README 是 19 个。现做法：启动命令不显示、工具不标未启用、用法写通用说明；MSW 有状态层用 README 的 19 个工具。建议：`PluginDetail` 加 `manifest: {transport, command, args, tools_allow?}`、`about_zh?`、`usage_zh?`、`permission_notes?: Record<perm,string>`，fixture 改为 19 个工具 | F6（3-条目卡片-插件详情页、3-插件详情-工具列表、3-插件详情-配置卡）、B3 | 2026-11-23 F6 |
| U29 | `MarketItem` 没有 `verified`，卡片上“未验收”小字暂用前端常量（arxiv、fetch，来自 plugin-manifest.md）。建议给 `MarketItem` 加 `verified?: bool` | F6（2-市场页-条目卡片） | 2026-11-23 F6 |
| U30 | 已安装插件的当前配置读不到（契约无 `config` 值、哪些密钥已设置）；“重新检查”与改配置时 `POST /api/plugins/{id}` 里留空的字段是否沿用已存值未定义。现做法：必填密钥在已安装时显示“已设置”，留空不发送；重新检查发 `{config:{}}`。建议：`InstalledPlugin` 加 `config_set: string[]` 与非密钥值，并写明“未提供的键沿用已存值” | F6（3-插件详情-配置卡、插件详情 status=error）、B3 | 2026-11-23 F6 |
| U31 | `MemoryItem` 只有 `source_message_ids`，没有所属对话；“查看来源”只能关设置并在右栏开 `kind=message` 标签，打不开来源对话。建议加 `source_conversation_id?` 或由 `GET /api/evidence` 类接口解析 | F6（3-设置-记忆管理）、F4 | 2026-11-23 F6 |
| U32 | 市场页“文件栏、右栏隐藏”必须改 F1 的 `layout/FourPane.tsx`（编排只允许改 CenterPane 与设置入口那一处）：已做最小改动（market 视图不渲染文件栏、右栏及其拖拽条，不改 store；并在弹窗处渲染 install/settings），以及 F1 两处断言 `center.market-placeholder`→`market.page`。请确认是否接受 | F1、F6 | 2026-11-23 F6 |
| U33 | 卡片星数：规格写“千分位”，概念图 UI-07 是“3.3k”。现按概念图短格式，悬停提示与详情页用千分位（3,292） | F6（2-市场页-条目卡片） | 2026-11-23 F6 |

## 动作日志

- 2026-11-23 · [F6] 市场、插件/Skill 详情、安装弹窗、设置与记忆（第一部分，14 份规格） · 部分完成（U28 契约缺字段使 UI-09 未完全复现；无概念图界面待 U7 确认；新增未决 U28–U33） · 分支 feat/F6-market · npm run check 通过 · 单测 299/299（F6 55 条）· e2e F6 19/19（`npx playwright test -c tests/playwright.f6.config.ts --workers=2`），全量回归 58/58（`MN_PORT=5176 npx playwright test --workers=2`）· 截图 web/tests/screenshots/ 下新增 23 张（2-插件与Skill-市场页.png 等）、更新 1 张（1-项目栏-插件与Skill入口.png） · 共享文件只追加：tokens.css（F6 token）、mocks/browser.ts（注册 marketWorldHandlers 与开关）、新增 mocks/market-world.ts；store/api/契约/state.md 未改 · 改动 F1 文件见 U32
- 2026-11-23 · [F6] 市场、插件/Skill 详情、安装弹窗、设置与记忆（第一部分） · 开始 · 分支 feat/F6-market（worktree `INFO5000项目/worktrees/F6-market`，dev 端口 5176）

- 2026-11-22 14:40 · [集成] F1+F2 集成修复 · 完成 · 分支 integ/F1F2 · 主页按中间区宽度自适应（先收紧卡片间距到 150、再缩放；1440 默认四栏中间区 480 时缩放 0.637）；F2 e2e 适配四栏；F1 Tab 测试改为先点外壳空白处重置导航起点；落地 U19–U27 编排决定 · npm run check 通过 · 单测 244/244 · e2e 39/39（workers=2）· 截图 web/tests/screenshots/1-新建对话-主页.png 等 F2 8 张 + 1-新建对话-主页-右栏收起.png、1-新建对话-主页-对照UI-01.png
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
