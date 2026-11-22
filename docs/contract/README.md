# 接口契约（contract）

本目录是前后端之间**唯一**的接口定义。UX 规格（`docs/ux/specs/`）里的“接口”一栏、前端 MSW mock、后端路由与测试，都以这里为准。来源是飞书立项稿《INFO5000- Mnemosyne 开发》第 6、8、10 章（revision 24），本目录在其基础上补齐了响应结构。

版本：**v0.1 草案（2026-11-22）**，待用户确认后改为 v1.0 并冻结。

| 文件 | 内容 |
|---|---|
| [rest-api.md](./rest-api.md) | REST 接口：路径、请求、响应、错误码 |
| [sse-events.md](./sse-events.md) | 发送消息后的 SSE 事件、顺序、断线续流 |
| [data-model.md](./data-model.md) | SQLite 19 张表的字段（唯一定义） |
| [evidence-locator.md](./evidence-locator.md) | 证据单元与各类来源的定位符 locator |
| [plugin-manifest.md](./plugin-manifest.md) | 插件 manifest、Skill 目录、市场 registry |
| [scripts.md](./scripts.md) | `server/scripts/` 各脚本的参数与输出字段 |
| [types.ts](./types.ts) | 前端可直接拷贝的 TypeScript 类型草案 |
| `fixtures/`（F0 里程碑产出） | 每个接口与事件的 JSON 样例，MSW 与后端测试共用 |

## 规则

1. **契约先行**：新增或修改接口，先改本目录并在 [`docs/PROGRESS.md`](../PROGRESS.md) 记一条“契约变更”，再改代码。前后端不得各自发明字段。
2. **命名**：REST 路径与 JSON 字段用 `snake_case`；前端 TS 类型字段保持 `snake_case`，不做驼峰转换，避免两套名字。
3. **时间**：一律 ISO 8601 字符串（UTC，带 `Z`）。ID 一律字符串，前缀区分类型：`prj_`、`cnv_`、`msg_`、`br_`、`doc_`、`evd_`、`cit_`、`ws_`、`mem_`、`job_`、`plg_`、`skl_`。
4. **错误**：非 2xx 响应体统一为 `{ "error": { "code": "...", "message": "...", "retriable": bool } }`，错误码表见 [rest-api.md](./rest-api.md#错误码)。
5. **fixtures**：`fixtures/<接口或事件名>.json`。一个接口至少一份成功样例、一份错误样例；SSE 至少一份完整回合（含 1 条 supported、1 条 partial、1 条 removed 引用）。
6. 立项稿与本目录冲突时，以本目录为准，并在进度文档记录差异。
