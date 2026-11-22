# 契约样例（fixtures）

F0 里程碑产出。MSW mock（`web/src/mocks/handlers.ts`）与后端测试共用这些样例。**不要手改 JSON**：数据源是 `web/src/mocks/fixtures-source.ts`，改完运行

```bash
cd web
npm run fixtures:gen      # 重新生成本目录全部 *.json
npm run check:fixtures    # 用 types.ts 校验结构与语义（已并入 npm run check）
```

场景是“深度学习导论”项目，与概念图 UI-05、UI-06 一致：Attention Is All You Need 第 4 页脚注 4、课件 L05 第 18 页、jalammar.github.io 的网页快照、历史对话“反向传播 · 作业 3”。市场条目机械转换自 `03-调研/插件与Skill市场素材.json`（星数查询日 2026-11-21），未增删、未改星数与许可证。

## 文件命名

| 文件 | 内容 |
|---|---|
| `<接口>.ok.json` / `<接口>.error.json` | 每个 REST 接口一份成功、一份错误样例。`<接口>` = 方法 + 去掉 `/api/` 的路径，`/` 换成 `-`，占位符去掉花括号，如 `GET /api/projects/{pid}/conversations` → `get-projects-pid-conversations` |
| `<接口>.<变体>.ok.json` | 同一接口的其他成功样例，如 `get-evidence-eid.message.ok.json`（历史对话证据）、`get-plugins-id.not-installed.ok.json`（未安装插件，`status=not_installed`） |
| `sse-turn-full.json` | `POST /api/conversations/{cid}/messages` 的完整回合：3 个步骤、3 条证据、8 段正文、3 条引用（supported / partial / removed）、`message.end` |
| `sse-turn-cancel.json` | 取消回合：引用以 `partial` 发出，`message.end(cancelled=true)` |
| `sse-turn-resume.json` | 第 5 个事件后断线（`disconnect_after_seq: 5`）；续流部分见 `get-messages-mid-events.ok.json` |
| `sse-turn-error.json` | 失败回合：`error` 事件后不再有 `message.end` |

## 外层格式

```jsonc
// REST
{ "endpoint": "GET /api/projects", "kind": "ok" | "error", "description": "…",
  "request": { "params": {…}, "query": {…}, "body": …, "files": [...] },   // 可省略
  "status": 200, "content_type": "text/plain",                            // content_type 缺省为 JSON
  "body": … }
// 事件流
{ "endpoint": "POST /api/conversations/{cid}/messages", "kind": "sse", "description": "…",
  "request": {…}, "status": 200, "content_type": "text/event-stream",
  "events": [ { "event": "message.start", "data": { "seq": 1, … } }, … ],
  "disconnect_after_seq": 5 }                                             // 仅断线样例
```

类型定义见 `web/src/mocks/fixture-types.ts`。外层字段只是“样例怎么存”，不属于接口契约。

## 偏移量约定（契约 v0.2）

`sentence_start/end`、`anchor_start/end`、`char_range` 都按去掉 `[[E#]]` 后的纯文本计算，**左闭右开 `[start, end)`、按 Unicode 码点计数**（contract/README.md 第 7 条）。Python 里 `text[start:end]` 即对应片段；JS 里要先 `Array.from(text)` 再切片，或用 F3 的换算函数。

主线第 1 条回答（`sse-turn-full.json`、`get-conversations-cid-tree.ok.json` 的 `msg_tf_a1`）的第一句故意用了数学斜体 `𝑑`（U+1D451，BMP 以外），之后所有偏移的码点计数比 UTF-16 计数小 1。`npm run check:fixtures` 会按码点切片核对引用句子与分支锚点，按 UTF-16 算就会报错。

代码、Markdown、Notebook 的 `lines: [start, end]` 是从 1 开始的闭区间，含义不同。
