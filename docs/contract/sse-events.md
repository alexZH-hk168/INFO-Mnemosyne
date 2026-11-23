# SSE 事件

`POST /api/conversations/{cid}/messages`、`POST /api/messages/{mid}/regenerate` 与 `GET /api/messages/{mid}/events` 返回同一种事件流。POST 请求不能用浏览器 `EventSource`，前端用 `fetch` + `ReadableStream` 解析。

每个事件的 `data` 都是 JSON，且都带递增整数 `seq`（同一条 assistant 消息内从 1 开始）。

## 事件

| event | data 字段 | 说明 |
|---|---|---|
| `message.start` | `seq, message_id, client_msg_id, user_message_id, parent_id, branch_id` | 用户消息已入库，助手消息已建立。`regenerate` 时没有新用户消息：`user_message_id` 为原用户消息，`client_msg_id` 为原用户消息的 client_msg_id（v0.2） |
| `step` | `seq, step_id, kind, label, status, duration_ms?, plugin_id?` | `kind ∈ search_materials \| search_web \| fetch_url \| recall_memory \| open_source \| plugin_tool \| load_skill`；`status ∈ running \| done \| error`；同一 `step_id` 会先 running 后 done/error；`plugin_id?`（v0.5 并行草案 [F6b]）：`kind=plugin_tool` 时发起调用的插件 id，同 `Message.steps[].plugin_id` |
| `evidence` | `seq, eid, label, source_type, source_id, title, locator, quote, sha256?` | 加入候选证据池，`label` 形如 `E3`；`source_type ∈ material \| web \| message \| plugin`。`eid` 就是 `Evidence.id`；`source_id` 与 `sha256` 同 `Evidence`（v0.2），前端用 `source_id` 打开预览标签 |
| `delta` | `seq, text` | 正文增量，含原始 `[[E3]]` 标记；前端先渲染成虚线的“待确认”胶囊 |
| `citation` | `seq, citation_id, eid, label, sentence_start, sentence_end, verdict` | `verdict ∈ supported \| partial \| removed`。supported → 胶囊转实心；partial → 句子加“推断”；removed → 胶囊消失 |
| `message.end` | `seq, message_id, usage: {prompt_tokens, completion_tokens}, latency_ms, cancelled: bool` | 已写库。前端只有收到它才把回答视为已保存 |
| `error` | `seq, code, message, retriable` | 回合失败；之后不再有 `message.end` |

`sentence_start/end` 是相对**去掉 `[[E#]]` 标记后的正文**的字符偏移，与分支锚点使用同一坐标：左闭右开、按 Unicode 码点计数（v0.2，见 [README 第 7 条](./README.md#规则)）。前端 JS 字符串按 UTF-16 索引，由 F3 的工具函数换算。

## 顺序

```text
message.start
  → (step | evidence | delta)*      实时交替
  → 正文生成完毕
  → 引用校验
  → citation*                        每条引用一个
  → 写库
  → message.end
```

取消（`POST /cancel`）后：停止生成，未校验的引用全部以 `verdict: "partial"` 发出，然后发 `message.end`（`cancelled: true`）。

### 推断标注（v0.5 草案，[B2]，U72）

- 模型只在有证据的句子末尾写本轮的 `[[E#]]`；没有证据、属于模型自己推理的句子不写编号，后端也不为它发 `citation`，前端不加任何标记。
- 带编号的句子经引用校验：`supported` 胶囊转实心；`partial` 句子加“推断”；`removed` 胶囊消失。一句里的编号全部 removed 时，这句话不再带任何标记。
- 正文里出现不在本轮证据池的 `E#`（模型编造的编号）：照样发一条 `citation`，`verdict: "removed"`，`eid` 为空串，前端据此去掉待确认胶囊。
- `message.start` 中值为空的 `parent_id`、`branch_id` 省略不发。

## 断线续流

1. 前端记录最后收到的 `seq` 与 `message_id`。
2. 连接断开后按 1 s、2 s、4 s 重试 `GET /api/messages/{mid}/events?after_seq=<seq>`。
3. 三次都失败：保留已渲染内容，显示“重新生成”。
4. 尚未收到 `message.start` 就断开：用同一个 `client_msg_id` 重新 POST，后端返回同一条消息的事件流，不会重复建消息。

## 心跳

后端每 15 s 发一行注释 `: ping`，前端忽略。超过 45 s 无任何数据视为断开。
