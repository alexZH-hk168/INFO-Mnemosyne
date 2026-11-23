# 评测脚本（E 里程碑）

LongMemEval_S（cleaned）与自建 BranchMem 的数据准备、跑分、判分与指标。契约见 `docs/contract/scripts.md`，方案见立项稿第 11 章。
评测代码与系统代码分开：`scripts/eval_lib/` 只用标准库与 httpx，不 import `app/`；系统 M 经适配器调用后端。

## 预算硬约束（未决 U2，必须先读）

1. 用户还没定模型与预算。**真跑之前，先在 dev-120 上只跑 M 的前 10 题**，看 `run_summary.json` 里的单题 token（`tokens_in_per_q`、`tokens_out_per_q`）、单题费用（`cost_usd_per_q`）和回放消耗（`replay`），报给用户，等用户确认预算后再扩大。
2. `run_eval.py` 的 `--max-items` 默认就是 10；`--max-items 0`（不限）只能在预算确认后使用。
3. 任何非 `fake` 的模型（读者、判分、嵌入）都会产生费用，代码里有闸门：不设环境变量 `MN_EVAL_ALLOW_PAID=1` 会直接报错退出。密钥只从环境变量读（`MN_EVAL_API_KEY`，退回 `OPENAI_API_KEY`），接口地址 `MN_EVAL_API_BASE`（默认 OpenAI）。
4. 单价用 `--price-in/--price-out`（美元/百万 token）按所选模型的官方价目填写；不填时费用记 `null`，不估算。

## 流水线

```bash
cd server
P=.venv/bin/python
# 1. 数据（官方文件约 277 MB；--download 会先检查剩余空间并校验 sha256）
$P scripts/prep_longmemeval.py --input <longmemeval_s_cleaned.json> --subset full   --out data/eval/lme_full.jsonl
$P scripts/prep_longmemeval.py --input <longmemeval_s_cleaned.json> --subset dev120 --out data/eval/lme_dev120.jsonl
$P scripts/gen_branchmem.py --input data/eval/lme_full.jsonl --n 150 --out data/eval/branchmem.jsonl   # 另出 .stats.json 与抽样 20 题 .review.md
# 2. 跑分（先 dev-120 的 M 前 10 题报成本，见上）
$P scripts/run_eval.py --system M --adapter backend --data data/eval/lme_dev120.jsonl --model <模型> --price-in <x> --price-out <y> --out runs/dev120-M
# 3. 判分（官方 GPT-4o judge；gpt-4o-mini 作便宜判分的敏感性检查）
$P scripts/judge.py --pred runs/full-M/predictions.jsonl --data data/eval/lme_full.jsonl --judge gpt-4o
# 4. 指标（全量 500 题 + 未参与调参的 380 题）
$P scripts/metrics.py --pred runs/full-{B1,B2,M,A1,A2,A4}/predictions.jsonl --judged runs/full-{B1,B2,M,A1,A2,A4}/judged-gpt-4o.jsonl \
    --data data/eval/lme_full.jsonl --dev-ids data/eval/lme_dev120.jsonl --out runs/metrics_lme.json
```

运行矩阵（scripts.md）：LongMemEval_S 跑 B1、B2、M、A1、A2、A4；BranchMem 跑 B2、M、A3。所有随机过程用种子 20261121，predictions 每行带 `config_hash`（系统、模型、k、数据 sha256、种子、提示版本、嵌入器/适配器与消融开关的哈希）。

## 系统与消融

| 代号 | 做法 | 本轮状态 |
|---|---|---|
| B1 | 全部 session 按时间顺序放进上下文 | 假模型下跑通 |
| B2 | 每个轮次（user、assistant 都算）一个块，嵌入余弦取前 k，要求按编号引用 | 假模型 + 本地哈希嵌入下跑通 |
| M | `eval_lib/adapter.py` 的 `BackendAdapter`：回放 session（按 session 缓存，各系统共用）→ 提问 → 回答、引用、检索结果 | 真实适配器 `MnemosyneBackendAdapter`（`eval_lib/backend.py`，INT1）：在本进程里调用后端数据库、B2 回合与 B3a 记忆任务；每题一个独立库（`--backend-data/items/<题目哈希>/`），回放缓存只在同题 M/A1–A4 间复用；A1 去掉 open_source 工具、A2 跳过引用校验、A3 记忆召回不按分支过滤、A4 不注入 L4 画像。假模型下 A1 与 M 结果相同（假模型从不调用 open_source） |
| A1 | `Flags(open_source=False)` 不回溯原文 | 同 M |
| A2 | `Flags(citations=False)` 不要求引用、不做引用校验；`cited_turn_hit_rate` 记不适用 | 同 M |
| A3 | `Flags(branch_scope=False)` 检索不按分支路径过滤（只在 BranchMem 上跑） | 同 M |
| A4 | `Flags(l4_profile=False)` 不注入 L4 画像 | 同 M |

`--adapter stub` 是本地词面检索 + 抽取式回答的桩，只为验证流水线（缓存、映射、分支过滤、引用开关），**它的数字不得写进论文**。

## 官方核对（2026-11-23）

- 字段与题型：官方 README（https://github.com/xiaowu0162/LongMemEval ，HEAD `9e0b455`）列出 `question_id, question_type, question, answer, question_date, haystack_session_ids, haystack_dates, haystack_sessions, answer_session_ids`；turn 为 `{role, content}`，证据轮带 `has_answer: true`；`question_id` 以 `_abs` 结尾为拒答题；6 类题型 `single-session-user / single-session-assistant / single-session-preference / temporal-reasoning / knowledge-update / multi-session`。另用 HTTP Range 只取了 `longmemeval_s_cleaned.json` 的前 12 KB，实际键名与 README 一致，日期格式为 `2023/05/30 (Tue) 23:40`，证据 session 的 id 以 `answer_` 开头。HF 预览报 `answer` 列有整数，转换时保留原类型。
- 文件与校验：HF `xiaowu0162/longmemeval-cleaned` 的 `longmemeval_s_cleaned.json` 大小 277383467，sha256 `d6f21ea9…c3a442`（取自 HF API 的 lfs 字段），写在 `eval_lib/lme.py`。数据集卡片未写许可证；数据不进仓库。
- 判分：`src/evaluation/evaluate_qa.py`（MIT，Copyright (c) 2024 Di Wu）。五段提示模板逐字移植到 `eval_lib/judge_prompts.py`（已用脚本与官方文件逐字比对一致），判定规则同官方：回复含 `yes` 即对、`'_abs' in question_id` 走拒答模板、temperature 0、max_tokens 10；gpt-4o 对应 `gpt-4o-2024-08-06`。
- 检索指标：官方 `src/retrieval/eval_utils.py` 给 recall_any/recall_all/ndcg，`print_retrieval_metrics.py` 主报 recall_all@k，并跳过拒答题；官方轮次级索引只含 user 轮、轮次编号从 1 开始。本仓库口径与差异见 `eval_lib/metrics_core.py` 文件头与未决 U101。
- 未核实：清洗版各题型的实际题数（论文给的是原版）、拒答题在清洗版里的 `answer_session_ids` 与 `has_answer` 标注方式（迷你数据按“相关 session、无 has_answer”手写）。

## 测试

```bash
cd server && .venv/bin/python -m pytest -q tests/test_eval_prep.py tests/test_eval_branchmem.py tests/test_eval_run.py
```

`tests/data/eval_mini/longmemeval_mini.json` 是手写的合成数据（16 题，字段与官方一致，覆盖 6 类题型与 3 道拒答题），不含任何真实数据集内容。
