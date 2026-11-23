# 评测脚本（E 里程碑）

LongMemEval_S（cleaned）与自建 BranchMem 的数据准备、跑分、判分与指标。契约见 `docs/contract/scripts.md`，方案见立项稿第 11 章。
评测代码与系统代码分开：`scripts/eval_lib/` 只用标准库与 httpx，不 import `app/`；系统 M 经适配器调用后端。

## 预算硬约束（未决 U2，必须先读）

1. 用户还没定模型与预算。**真跑之前，先在 dev-120 上只跑 M 的前 10 题**，看 `run_summary.json` 里的单题 token（`tokens_in_per_q`、`tokens_out_per_q`）、单题费用（`cost_usd_per_q`）和回放消耗（`replay`），报给用户，等用户确认预算后再扩大。
2. `run_eval.py` 的 `--max-items` 默认就是 10；`--max-items 0`（不限）只能在预算确认后使用。
3. 任何非 `fake` 的模型（读者、判分、嵌入）都会产生费用，代码里有闸门：不设环境变量 `MN_EVAL_ALLOW_PAID=1` 会直接报错退出。密钥先读环境变量（`MN_EVAL_API_KEY`，退回 `OPENAI_API_KEY`），接口地址 `MN_EVAL_API_BASE`；都没设时读用户在设置页保存的 `settings.json`（BYOK，与对话、记忆同一份），再缺省才是 OpenAI 官方地址。系统 M 的后端适配器同样读这份设置，`--model` 只覆盖对话模型名。
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
| M | `eval_lib/adapter.py` 的 `BackendAdapter`：回放 session（按 session 缓存，各系统共用）→ 提问 → 回答、引用、检索结果 | 真实适配器 `MnemosyneBackendAdapter`（`eval_lib/backend.py`，INT1）：在本进程里调用后端数据库、B2 回合与 B3a 记忆任务；每题一个独立库（`--backend-data/items/<题目哈希>/`），回放缓存只在同题 M/A1–A4 间复用；A1 去掉 open_source 工具、A2 跳过引用校验、A3 记忆召回不按分支过滤、A4 不注入 L4 画像。eval_mini 上假模型的 A1 与 M 结果相同（这批题假模型没有调用 open_source），A1 的差别要等真实模型才看得出 |
| A1 | `Flags(open_source=False)` 不回溯原文 | 同 M |
| A2 | `Flags(citations=False)` 不要求引用、不做引用校验；`cited_turn_hit_rate` 记不适用 | 同 M |
| A3 | `Flags(branch_scope=False)` 检索不按分支路径过滤（只在 BranchMem 上跑） | 同 M |
| A4 | `Flags(l4_profile=False)` 不注入 L4 画像 | 同 M |

`--adapter stub` 是本地词面检索 + 抽取式回答的桩，只为验证流水线（缓存、映射、分支过滤、引用开关），**它的数字不得写进论文**。

## 已知限制（真跑前必读）

- **每题一位新用户、独立库（U111，编排决定，待用户追认）**：系统 M 每题一个全新数据库，因为记忆有 global 作用域，共库会跨题召回。代价是 LongMemEval 的填充 session 在题间重复时要重新回放，回放成本按题线性增长；真实模型下记忆抽取费用随题数增长。回放缓存只在同一题的 M/A1–A4 之间复用，不跨题。替代做法（按 session 内容建共享库再按题复制）本版不做。论文里按“每题一位新用户”描述实验设置。
- **记账低估与缺项（U112，编排决定接受为已知限制，待用户追认）**：
  - 记忆的 `llm_port` 不回报 token，真实模型下 `replay_tokens_*` 与回放费用记 0，**低估**真实花费；
  - M 的 `cost_usd` 记 `null`：适配器不知道单价，`--price-in/--price-out` 只作用于 B1/B2；
  - `retrieved_ids` 的分数是按名次的 1/(rank+1)，evidence 表不存召回分数，依赖分数绝对值的指标不能用。
  - 报成本（见“预算硬约束”）时必须写明这三点。是否给 `llm_port` 加用量回报、是否给证据落召回分数，等真跑（U2）前再定。

## 官方核对（2026-11-23）

- 字段与题型：官方 README（https://github.com/xiaowu0162/LongMemEval ，HEAD `9e0b455`）列出 `question_id, question_type, question, answer, question_date, haystack_session_ids, haystack_dates, haystack_sessions, answer_session_ids`；turn 为 `{role, content}`，证据轮带 `has_answer: true`；`question_id` 以 `_abs` 结尾为拒答题；6 类题型 `single-session-user / single-session-assistant / single-session-preference / temporal-reasoning / knowledge-update / multi-session`。另用 HTTP Range 只取了 `longmemeval_s_cleaned.json` 的前 12 KB，实际键名与 README 一致，日期格式为 `2023/05/30 (Tue) 23:40`，证据 session 的 id 以 `answer_` 开头。HF 预览报 `answer` 列有整数，转换时保留原类型。
- 文件与校验：HF `xiaowu0162/longmemeval-cleaned` 的 `longmemeval_s_cleaned.json` 大小 277383467，sha256 `d6f21ea9…c3a442`（取自 HF API 的 lfs 字段），写在 `eval_lib/lme.py`。数据集卡片未写许可证；数据不进仓库。
- 判分：`src/evaluation/evaluate_qa.py`（MIT，Copyright (c) 2024 Di Wu）。五段提示模板逐字移植到 `eval_lib/judge_prompts.py`（已用脚本与官方文件逐字比对一致），判定规则同官方：回复含 `yes` 即对、`'_abs' in question_id` 走拒答模板、temperature 0、max_tokens 10；gpt-4o 对应 `gpt-4o-2024-08-06`。
- 检索指标：官方 `src/retrieval/eval_utils.py` 给 recall_any/recall_all/ndcg，`print_retrieval_metrics.py` 主报 recall_all@k，并跳过拒答题；官方轮次级索引只含 user 轮、轮次编号从 1 开始。本仓库口径与差异见 `eval_lib/metrics_core.py` 文件头与未决 U101。
- 已核实（[VER1] 2026-11-23，下载的清洗版 `longmemeval_s_cleaned.json`，sha256 与登记一致）：500 题，multi-session 133、temporal-reasoning 133、knowledge-update 78、single-session-user 70、single-session-assistant 56、single-session-preference 30，其中拒答 30（ssu 6、ms 12、tr 6、ku 6）；拒答题 30 道都给了 `answer_session_ids`，其中共 10 个轮次标了 `has_answer`（迷你数据按“相关 session、无 has_answer”手写，与真实数据在这一点不同；检索指标本就跳过拒答题，不影响结果）。单题 haystack 平均 101,495 token（tiktoken o200k_base，95,156–103,818）、平均 47.7 个 session。
- [VER1] 注意：`lme_dev120.jsonl` 按题型排序，`--max-items 10` 取到的前 10 题全是 single-session-user（U146）；系统 M 的 `recall@k_turn` 口径待定（U142）。

## 测试

```bash
cd server && .venv/bin/python -m pytest -q tests/test_eval_prep.py tests/test_eval_branchmem.py tests/test_eval_run.py
```

`tests/data/eval_mini/longmemeval_mini.json` 是手写的合成数据（16 题，字段与官方一致，覆盖 6 类题型与 3 道拒答题），不含任何真实数据集内容。
