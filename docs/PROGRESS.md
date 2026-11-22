# 进度看板

最后更新：2026-11-22。仓库只在云电脑本地，未推送远端。规格为草案；契约为 v0.2 草案（编排 Agent 决定，待用户追认）。

## 里程碑

| 里程碑 | 内容 | 依赖 | 状态 | 认领（分支 · 日期） |
|---|---|---|---|---|
| F0 | 契约 fixtures、`web/` 脚手架、tokens、MSW、类型、store 骨架 | 契约 v1.0 确认（用户已同意按 v0.1 草案开工） | 完成（待编排 Agent 验收与合并） | feat/F0-scaffold · 2026-11-22 |
| F1 | 外壳、拖拽与收起、项目栏、文件栏 | F0 | 未开始 | |
| F2 | 主页、卡片与动效、卡片弹窗 | F0 | 未开始 | |
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

## 动作日志

- 2026-11-22 21:06 · [F0] 契约 fixtures 与前端脚手架 · 完成 · 分支 feat/F0-scaffold · npm run check 通过（84 份 fixture、38/38 接口）· 单测 150/150 · e2e 3/3 · 截图 web/tests/screenshots/F0-占位页-tokens.png
- 2026-11-22 21:06 · [F0] 契约 · 契约变更 v0.2 · 编排 Agent 决定，待用户追认：rest-api.md、sse-events.md、types.ts、data-model.md、evidence-locator.md、contract/README.md、ux/state.md 按 U11–U18 修改；规格源 specs_a.py（文件栏按 group 分组、网页来源行用 `snapshot_id`）已重新生成；fixtures 重新生成
- 2026-11-22 21:00 · [F0] 契约 fixtures 与前端脚手架 · 阻塞（交付物已全部完成并本地提交；契约/状态约定 U11–U18 待用户确认，确认后改 `web/src/mocks/fixtures-source.ts` 重新生成即可） · 分支 feat/F0-scaffold · npm run check 通过（83 份 fixture、38/38 接口）· 单测 144/144 · e2e 3/3 · 截图 web/tests/screenshots/F0-占位页-tokens.png
- 2026-11-22 · [F0] 契约 fixtures 与前端脚手架 · 开始 · 分支 feat/F0-scaffold（worktree `INFO5000项目/worktrees/F0-scaffold`）
- 2026-11-22 17:20 · 文档 · 重写 AGENTS.md（读文件顺序、目录与修改权限、冲突优先级、红线 R1–R8、停下询问的情况）；提示词改为指向云电脑本地仓库；规定暂不推送
- 2026-11-22 · 文档 · 初始化 README、AGENTS.md、开发规范、契约 v0.1 草案、88 份 UX 规格、开发提示词 · 未写代码
