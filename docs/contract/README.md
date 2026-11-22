# 接口契约（contract）

本目录是前后端之间**唯一**的接口定义。UX 规格（`docs/ux/specs/`）里的“接口”一栏、前端 MSW mock、后端路由与测试，都以这里为准。来源是飞书立项稿《INFO5000- Mnemosyne 开发》第 6、8、10 章（revision 24），本目录在其基础上补齐了响应结构。

版本：**v0.2 草案（2026-11-22）**。v0.2 由编排 Agent 在用户授权下决定，待用户追认；确认后改为 v1.0 并冻结。

| 文件 | 内容 |
|---|---|
| [rest-api.md](./rest-api.md) | REST 接口：路径、请求、响应、错误码 |
| [sse-events.md](./sse-events.md) | 发送消息后的 SSE 事件、顺序、断线续流 |
| [data-model.md](./data-model.md) | SQLite 19 张表的字段（唯一定义） |
| [evidence-locator.md](./evidence-locator.md) | 证据单元与各类来源的定位符 locator |
| [plugin-manifest.md](./plugin-manifest.md) | 插件 manifest、Skill 目录、市场 registry |
| [scripts.md](./scripts.md) | `server/scripts/` 各脚本的参数与输出字段 |
| [types.ts](./types.ts) | 前端可直接拷贝的 TypeScript 类型草案 |
| `fixtures/`（F0 里程碑产出） | 每个接口与事件的 JSON 样例，MSW 与后端测试共用；格式与生成方式见 [fixtures/README.md](./fixtures/README.md) |

## 规则

1. **契约先行**：新增或修改接口，先改本目录并在 [`docs/PROGRESS.md`](../PROGRESS.md) 记一条“契约变更”，再改代码。前后端不得各自发明字段。
2. **命名**：REST 路径与 JSON 字段用 `snake_case`；前端 TS 类型字段保持 `snake_case`，不做驼峰转换，避免两套名字。
3. **时间**：一律 ISO 8601 字符串（UTC，带 `Z`）。ID 一律字符串，前缀区分类型：`prj_`、`cnv_`、`msg_`、`br_`、`doc_`、`evd_`、`cit_`、`ws_`、`mem_`、`job_`。**例外（v0.2）**：插件 id 用 manifest 的 `id`（如 `arxiv`），Skill id 用 `SKILL.md` 的 `name`（如 `pdf`），都不加前缀；原定的 `plg_`、`skl_` 作废。
4. **错误**：非 2xx 响应体统一为 `{ "error": { "code": "...", "message": "...", "retriable": bool, "details"?: {...} } }`，`details` 可选（v0.2），错误码表见 [rest-api.md](./rest-api.md#错误码)。
5. **fixtures**：`fixtures/<接口或事件名>.json`。一个接口至少一份成功样例、一份错误样例；SSE 至少一份完整回合（含 1 条 supported、1 条 partial、1 条 removed 引用）。
6. 立项稿与本目录冲突时，以本目录为准，并在进度文档记录差异。
7. **偏移与行号**（v0.2）：所有字符偏移（`sentence_start/end`、`anchor_start/end`、各 locator 的 `char_range`）一律**左闭右开 `[start, end)`、按 Unicode 码点计数**，对应文本为去掉 `[[E#]]` 标记后的纯文本（网页为快照 `text`）。后端 Python `s[start:end]` 直接可用；前端 JS 字符串按 UTF-16 索引，必须经 F3 提供的工具函数换算。代码/Markdown/Notebook 的行号 `lines: [start, end]` 是另一种含义：从 1 开始的**闭区间**。

## 版本记录

| 版本 | 日期 | 变更 | 来源 |
|---|---|---|---|
| v0.1 | 2026-11-22 | 初稿 | 立项稿第 6、8、10 章 |
| v0.2 | 2026-11-22 | `Document` 加 `group`、`cells?`、`snapshot_id?`，文件列表按 `group` 分组；SSE `evidence` 加 `source_id`、`sha256?`；`PluginDetail.verified` 写入 rest-api，未安装插件 `status=not_installed`；错误体加 `details?`；插件/Skill id 不加前缀；偏移统一左闭右开、按码点；regenerate 的 `message.start` 字段；`context_messages` 含被引消息本身 | F0 提出 U11–U18，编排 Agent 决定，待用户追认 |
