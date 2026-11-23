# 脚本

全部在 `server/scripts/`，命令行运行，输出 JSONL 或 JSON，供论文复现。

| 脚本 | 参数 | 输出字段 |
|---|---|---|
| `init_db.py` | `--db 路径` | 建表并写入 schema 版本 |
| `ingest.py` | `--project`, `--path`（文件或目录）, `--reindex` | 每文件一行：`document_id, kind, pages, segments, chunks, status, error` |
| `build_registry.py` | `--in 调研 JSON`, `--out registry/` | `plugins.json` / `skills.json`：`id, name, owner, repo_url, stars, stars_date, license, category, official, desc_zh, manifest` |
| `prep_longmemeval.py` | `--split s_cleaned`, `--subset dev120 \| full`, `--seed 20261121` | `question_id, question_type, question, answer, question_date, sessions[], answer_session_ids[], is_abstention` |
| `gen_branchmem.py` | `--src longmemeval`, `--n 150`, `--seed` | `item_id, src_question_id, tree, query_node_id, gold_answer, distractor_value, gold_path_session_ids, distractor_branch_session_ids, type（update \| single）` |
| `run_eval.py` | `--system B1\|B2\|M\|A1\|A2\|A3\|A4`, `--data`, `--model`, `--k 8`, `--out` | `predictions.jsonl`：`question_id, question_type, system, config_hash, hypothesis, cited_message_ids, cited_session_ids, retrieved_ids（有序 [{session_id, turn_idx, score}]）, abstained, branch_id, leaked_ids, tokens_in, tokens_out, latency_ms, cost_usd, error`；另存 `msg_map.jsonl`：`message_id → (session_id, turn_idx)` |
| `judge.py` | `--pred`, `--data`, `--judge gpt-4o` | `question_id, correct（0/1）, judge_raw` |
| `metrics.py` | `--pred`, `--judged`, `--data` | 按系统与题型：`qa_acc, recall@k_session, recall@k_turn, cited_turn_hit_rate, abstention_acc, branch_acc, leak_rate, tokens_per_q, latency_p50` |

## 评测脚本的可选参数与附带输出（v0.5，U104，INT1 补录）

上表是立项稿定的核心参数与字段；E 实现时追加了下面这些**可选**参数与附带文件，上表字段一个没改。

| 脚本 | 追加的可选参数 | 附带输出 |
|---|---|---|
| `prep_longmemeval.py` | `--input 本地官方 JSON`（与 `--download` 二选一）、`--download`（从 Hugging Face 取并校验 sha256）、`--download-dir`（默认 `server/data/longmemeval`）、`--dev-size`（默认 120，测试用小值）、`--out`（默认 `server/data/eval/longmemeval_<split>_<subset>.jsonl`） | `<out>.meta.json`：`split, subset, seed, source, source_sha256, n, allocation（dev120 各题型题数）, question_ids` |
| `gen_branchmem.py` | `--input`（prep 的 full 输出）、`--review-n`（默认 20）、`--out`（默认 `server/data/eval/branchmem.jsonl`） | `<out>.stats.json`：`target, generated, candidates, by_type, skipped{answer_not_verbatim, no_distractor}, shortfall`；`<out>.review.md`：抽样人工核对稿 |
| `run_eval.py` | `--max-items`（默认 10，`0`＝不限，预算确认后才用，U2）、`--embed`（B2 的嵌入器：`hash` 或 `openai:<模型>`）、`--adapter backend\|stub`（M/A1–A4；`stub` 只做流水线自检）、`--backend-data`（`backend` 适配器的后端数据目录，默认 `<out>/../backend_data`，每题一个库 `items/<题目哈希>/mnemosyne.db`）、`--cache-dir`（回放缓存，默认 `<out>/../replay_cache`）、`--price-in`/`--price-out`（每百万 token 美元）、`--seed`、`--resume`（保留同 `config_hash` 已完成的题） | `run_summary.json`：`config, config_hash, n_items, n_errors, tokens_in_per_q, tokens_out_per_q, cost_usd_per_q, cost_usd_total, replay{replay_tokens_in, replay_tokens_out, replay_cost_usd, cache_hits, cache_misses}, wall_s, max_items`；`msg_map.jsonl` 每行 `message_id, session_id, turn_idx`；`backend_data/items/*/eval_instance.txt`（库实例标识，进回放缓存键） |
| `judge.py` | `--judge gpt-4o\|gpt-4o-mini`、`--out`（默认 `<pred 目录>/judged-<judge>.jsonl`） | 每行另带 `judge_model, config_hash`（与 predictions 配对核对） |
| `metrics.py` | `--pred`/`--judged` 可多个（一一对应）、`--msg-map`（默认各 predictions 同目录的 `msg_map.jsonl`）、`--dev-ids`（调参用的 dev 题号，另报 heldout）、`--k`、`--out` | `--out` JSON：`{k, rows: [{split: full\|heldout, system, question_type, …上表指标}]}`；标准输出为 Markdown 表 |

付费闸门：B1/B2 的模型与 `--adapter backend` 的模型不是 `fake` 时，必须设环境变量 `MN_EVAL_ALLOW_PAID=1`，否则直接报错退出。

系统 M/A1–A4 的 `backend` 适配器（`server/scripts/eval_lib/backend.py`）在评测进程里直接调用后端的数据库、Agent 回合与记忆任务（与 `POST /api/conversations/{cid}/messages` 走同一条回合代码）。`retrieved_ids` 取召回步骤登记的证据来源消息，按出现顺序给分 `1/(rank+1)`（后端不落库原始召回分数）；`cost_usd` 记 `null`（适配器不知道单价）。

## 运行矩阵

- LongMemEval_S：B1、B2、M、A1、A2、A4（6 个配置）。
- BranchMem：B2、M、A3（3 个配置）。
- 报告全量 500 题，并单独报告未参与调参的 380 题。
- A2 不要求引用，`cited_turn_hit_rate` 记为不适用。
- BranchMem 泄漏判定：回答采用了兄弟分支里的 `distractor_value`，或引用了兄弟分支消息，任一即计泄漏。
