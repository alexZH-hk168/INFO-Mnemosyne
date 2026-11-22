# 进度看板

最后更新：2026-11-22。仓库只在云电脑本地，未推送远端。规格与契约为草案 v0.1，等用户确认。

## 里程碑

| 里程碑 | 内容 | 依赖 | 状态 | 认领（分支 · 日期） |
|---|---|---|---|---|
| F0 | 契约 fixtures、`web/` 脚手架、tokens、MSW、类型、store 骨架 | 契约 v1.0 确认（用户已同意按 v0.1 草案开工） | 交付物已完成，待验收；U11–U18 待确认 | feat/F0-scaffold · 2026-11-22 |
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
| `docs/contract/fixtures/`、`web/src/api/types.ts`、`web/src/store/*`、`web/src/styles/tokens.css` | feat/F0-scaffold（合并进 main 后释放） | 2026-11-22 |

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
| U11 | 文件分组：`GET /api/projects/{pid}/documents` 的“code+ipynb”组 `kind` 取什么值未定义（fixture 暂用 `code`，组内同时含 ipynb）。另：概念图 UI-05/06 把「L04 反向传播.pdf」放在“课件”组，而契约与规格按 kind 分组，PDF 课件会进“论文”组。建议：组 kind 用 `code`，并接受“按文件类型分组”，概念图以规格为准 | F1、B1 | 2026-11-22 F0 |
| U12 | SSE `evidence` 事件没有 `source_id`（且 id 字段叫 `eid`），但 state.md 把 `streaming.evidence` 写成 `Evidence[]`；缺 `source_id` 时前端点胶囊无法打开材料预览标签（`openTab` 的 `ref_id` 需要文档 id）。建议给 evidence 事件加 `source_id`；F0 的 store 暂按事件实际字段存 | F3、F4、B2 | 2026-11-22 F0 |
| U13 | state.md 缺规格里引用的 action：`useUI.openModal/closeModal/pushToast`、`useChat.setProject/setConversation`、`useLayout.setMarketRoute`，`useLayout.view` 也没有 setter；`Toast.action` 结构未写（F0 暂定 `{label, onClick}`）。F0 按“严格照 state.md”未实现这些 action。建议补进 state.md 后由 F1 实现 | F1、F2、F6 | 2026-11-22 F0 |
| U14 | `mn.layout.v1` 持久化哪些字段未写。F0 暂只存 `sizes`、`collapsed`（右栏标签与 `view` 随路由和数据恢复） | F1 | 2026-11-22 F0 |
| U15 | 插件接口：① types.ts 的 `PluginDetail.verified` 在 rest-api.md 里没写（fixture 按 types.ts 带上）；② 未安装时 `GET /api/plugins/{id}` “返回市场 manifest 与上游工具清单”的结构和 `status` 取值未定义；③ `PLUGIN_SELF_CHECK_FAILED` 要“附 log_tail”，但统一错误体没有这个字段；④ README 规定插件/Skill ID 用 `plg_`/`skl_` 前缀，但 plugin-manifest.md 示例 id 是 `arxiv`（工具命名空间 `arxiv__search_papers` 也按它）。fixture 暂用 `plg_arxiv` | F6、B3 | 2026-11-22 F0 |
| U16 | 偏移量约定未写明：`sentence_start/end`、`anchor_start/end`、`char_range` 是左闭右开还是闭区间；按 UTF-16 码元（前端 JS）还是 Unicode 码点（后端 Python）计数。fixture 采用左闭右开，样例无 BMP 外字符。建议写进契约：左闭右开、按码点计数，前端做换算 | F3、F5、B2 | 2026-11-22 F0 |
| U17 | ① `regenerate` 的 `message.start` 里 `client_msg_id`、`user_message_id` 填什么（fixture 用原用户消息的）；② 证据 `context_messages`“被引消息前后各 1 条”是否包含被引消息本身（fixture 包含，否则右栏拿不到原文） | F3、F4、B2 | 2026-11-22 F0 |
| U18 | `Document` 没有 ipynb 单元格数字段（概念图显示“14 格”）；`kind=web` 的 Document 与 `web_snapshots` 如何对应未定义 | F1、F4、B1 | 2026-11-22 F0 |

## 动作日志

- 2026-11-22 21:00 · [F0] 契约 fixtures 与前端脚手架 · 阻塞（交付物已全部完成并本地提交；契约/状态约定 U11–U18 待用户确认，确认后改 `web/src/mocks/fixtures-source.ts` 重新生成即可） · 分支 feat/F0-scaffold · npm run check 通过（83 份 fixture、38/38 接口）· 单测 144/144 · e2e 3/3 · 截图 web/tests/screenshots/F0-占位页-tokens.png
- 2026-11-22 · [F0] 契约 fixtures 与前端脚手架 · 开始 · 分支 feat/F0-scaffold（worktree `INFO5000项目/worktrees/F0-scaffold`）
- 2026-11-22 17:20 · 文档 · 重写 AGENTS.md（读文件顺序、目录与修改权限、冲突优先级、红线 R1–R8、停下询问的情况）；提示词改为指向云电脑本地仓库；规定暂不推送
- 2026-11-22 · 文档 · 初始化 README、AGENTS.md、开发规范、契约 v0.1 草案、88 份 UX 规格、开发提示词 · 未写代码
