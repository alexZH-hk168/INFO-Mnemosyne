# E1+E2 评测：数据准备、跑分与指标

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库：https://github.com/alexZH-hk168/INFO-Mnemosyne（分支 main）。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与推送规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
4. `docs/contract/scripts.md`（参数、输出字段、运行矩阵）
5. 架构图 `docs/assets/arch/f8-evaluation.png`；LongMemEval 官方仓库 https://github.com/xiaowu0162/LongMemEval 的 README 与 `evaluate_qa.py`

## 任务

1. `prep_longmemeval.py`：下载 LongMemEval_S cleaned 版，按 6 类题型 + 拒答分层抽 dev-120（种子 20261121），输出字段照 scripts.md。先核对数据集真实字段名（`answer_session_ids`、`has_answer`、`_abs` 后缀等）与官方说明一致，不一致就以官方为准并告诉我。
2. `gen_branchmem.py`：从知识更新题与单 session 题改造消息树，正确证据放在提问节点祖先路径，`distractor_value` 放进兄弟分支；目标 150 题；输出抽样 20 题的可读版本给我人工核对。
3. `run_eval.py`：系统 B1（全量上下文）、B2（朴素 RAG，按轮切块，要求引用检索到的轮次）、M（完整系统，通过后端 Python API 回放 session，按 session_id 缓存回放结果）、A1–A4 消融。输出 predictions.jsonl 与 msg_map.jsonl。
4. `judge.py` 调官方判分逻辑；`metrics.py` 按 scripts.md 计算全部指标，分别报告全量 500 题与未参与调参的 380 题。

## 硬约束

- **先在 dev-120 上跑 M 的前 10 题，报告单题 token 与费用，等我确认预算后再扩大**（未决 U2）。
- 不修改判分规则来抬高分数；结果不支持假设也照实报告。
- 所有随机过程固定种子，结果文件带 config_hash。

## 验收

- 运行矩阵（LongMemEval_S 6 个配置、BranchMem 3 个配置）的结果表；每个数字都能从 predictions 与 judged 文件复算。

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建分支 `feat/E-eval`（用 git worktree，如果别的 Agent 也在这个仓库工作）；不直接推 main，不 force push。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
