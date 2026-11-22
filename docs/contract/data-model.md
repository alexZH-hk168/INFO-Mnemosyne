# 数据模型（SQLite）

字段的唯一定义。立项稿图 3（`docs/assets/arch/f7-data-model.png`）、接口类型与测试样例都以本表为准。类型省略时为 TEXT；时间字段为 ISO 8601 字符串；`_json` 结尾为 JSON 文本。数据库开 WAL 模式，单文件 `data/mnemosyne.db`，工作目录 `data/`（上传原件、网页快照、记忆 Markdown）。

## 对话

| 表 | 字段 |
|---|---|
| projects | id, name, created_at |
| conversations | id, project_id, title, root_message_id, active_leaf_id（重新生成后当前显示的叶子）, created_at, updated_at |
| messages | id, conversation_id, parent_id, branch_id（主线为 NULL）, role（user \| assistant \| tool \| merge_note）, content, model, usage_json, created_at；另加 client_msg_id（唯一索引，用于去重） |
| branches | id, conversation_id, fork_message_id, anchor_start INT, anchor_end INT（相对 fork 消息去标记纯文本的字符偏移）, anchor_quote, title, status（open \| merged \| archived）, merged_into_message_id, created_at |
| tool_calls | id, message_id, step_index INT, tool_name, args_json, result_json, status, duration_ms INT |
| citations | id, message_id, evidence_id, label, sentence_start INT, sentence_end INT, verdict（supported \| partial \| removed）, overlap REAL |

`messages.client_msg_id` 与 SSE 续流用的事件缓冲（`message_events(message_id, seq, event, data_json)`）是为契约补充的字段/表，立项稿未列，F0 确认后补进图 3。

## 材料与证据

| 表 | 字段 |
|---|---|
| documents | id, project_id, kind（pdf \| pptx \| code \| ipynb \| md \| web）, title, path, sha256, pages INT, parse_status（queued \| parsing \| ready \| failed）, parse_error, created_at |
| segments | id, document_id, kind（sentence \| line \| cell \| shape）, text, locator_json, order_idx INT |
| chunks | id, document_id, text, segment_ids_json, token_count INT；附表 chunks_fts（FTS5）与 chunks_vec（sqlite-vec） |
| evidence | id, source_type（material \| web \| message \| plugin）, source_id, locator_json, quote, sha256, created_at；另加 captured_in_message_id（网页/插件证据在哪条消息里被抓取，用于分支可见性） |
| web_snapshots | id, url, title, fetched_at, text, sha256, http_status INT |

## 记忆

| 表 | 字段 |
|---|---|
| memory_items | id, scope（global \| project \| branch）, scope_id, topic, content, source_message_ids_json, status（active \| superseded \| deleted）, superseded_by, valid_from, valid_to, confidence REAL, created_at |
| memory_topics | id, scope, scope_id, name, md_path, updated_at |
| memory_summaries | id, scope, scope_id, content（L4 画像，≤ 800 token）, version INT, updated_at |
| conversation_digests | id, conversation_id, branch_id, upto_message_id, content, updated_at |

另加 `memory_blocklist(id, content_hash, created_at)`：用户删除的条目，抽取时跳过（立项稿 §7.4）。

## 插件与任务

| 表 | 字段 |
|---|---|
| plugins | id, name, version, manifest_json, config_json（API Key 加密存储）, status（installed \| error \| disabled）, last_check_at |
| skills | id, name, description, dir_path, source_url, license, enabled INT |
| conversation_plugins | conversation_id, plugin_id, enabled INT |
| jobs | id, kind（parse_document \| index_web \| extract_memory \| rewrite_digest \| rewrite_profile）, payload_json, status（queued \| running \| done \| failed）, attempts INT, error, created_at, finished_at |

## 分支可见性（必须在仓储层实现）

判断“当前路径”＝从 `active` 叶子沿 `parent_id` 回到根的消息集合。

- `recall_memory` 只返回 global、project 条目，以及 `scope=branch` 且 `scope_id` 在当前路径上的条目。
- L4 画像只汇总 global 与 project 条目。
- `open_source(msg_id)`：消息不在当前路径上 → `NOT_VISIBLE_ON_PATH`。
- 网页/插件证据：`captured_in_message_id` 在当前路径上才可见；用户上传材料属于项目，全部可见。
- 合并后分支条目 `scope` 改为 project。
