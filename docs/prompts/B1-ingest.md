# B1 后端：数据库、材料解析与检索

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库：https://github.com/alexZH-hk168/INFO-Mnemosyne（分支 main）。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与推送规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
4. `docs/contract/` 全部文件，特别是 data-model.md、evidence-locator.md、scripts.md
5. 架构图 `docs/assets/arch/f1-system.png`、`f4-evidence.png`、`f7-data-model.png`

## 任务

在 `server/` 建 FastAPI 项目（Python 3.11、uv 管理依赖、pytest）。实现：
1. `server/app/db/schema.sql` 按 data-model.md 建全部表（含契约补充的 `message_events`、`memory_blocklist`、`client_msg_id`、`captured_in_message_id`），开 WAL；`scripts/init_db.py`。
2. 上传与解析任务：PDF（PyMuPDF，句子级切分并记录 bbox）、PPTX（python-pptx 取文本框；LibreOffice 转 PDF 供预览）、代码（按函数/类与行号）、Notebook（按单元格，输出单元格不入检索）、Markdown。解析进度写 jobs 表并通过 `/api/documents/{did}` 返回。
3. chunk 化（300–500 token，记录 segment_ids）、FTS5 与 sqlite-vec 索引；嵌入模型走可配置的适配层。
4. 混合检索：BM25 与向量各取前 50，RRF（k=60）融合，取前 8。
5. 接口：项目、对话（不含发消息）、文档列表/上传/详情/raw/reparse、evidence、web_snapshots，全部按 rest-api.md。
6. `scripts/ingest.py`。

## 验收

- 契约 fixtures 中对应接口的响应结构全部通过校验（写一个 pytest 自动比对）。
- 用 arXiv 1706.03762 PDF 测试：第 4 页脚注 4 的句子能检索到，locator 的 bbox 与前端 F4 高亮位置一致。
- 加密 PDF、扫描件返回 `PARSE_FAILED` 与可读原因。
- 前端去掉对应 MSW handler 后，文件栏与预览在真实后端上可用。

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建分支 `feat/B1-ingest`（用 git worktree，如果别的 Agent 也在这个仓库工作）；不直接推 main，不 force push。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
