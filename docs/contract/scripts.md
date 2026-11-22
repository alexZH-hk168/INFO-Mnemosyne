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

## 运行矩阵

- LongMemEval_S：B1、B2、M、A1、A2、A4（6 个配置）。
- BranchMem：B2、M、A3（3 个配置）。
- 报告全量 500 题，并单独报告未参与调参的 380 题。
- A2 不要求引用，`cited_turn_hit_rate` 记为不适用。
- BranchMem 泄漏判定：回答采用了兄弟分支里的 `distractor_value`，或引用了兄弟分支消息，任一即计泄漏。
