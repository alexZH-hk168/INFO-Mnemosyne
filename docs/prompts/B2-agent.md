# B2 后端：Agent 主回路、SSE 与引用校验

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库在云电脑本地：`/home/user/workspace/INFO5000项目/INFO-Mnemosyne`（git，分支 main）。远端 GitHub 还没同步，不要从 https://github.com/alexZH-hk168/INFO-Mnemosyne 克隆，也不要 git push。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与分支规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
4. `docs/contract/sse-events.md`、`rest-api.md` 的“消息”一节、`evidence-locator.md` 的“引用校验三关”
5. 架构图 `docs/assets/arch/f2-turn-pipeline.png`、`f4-evidence.png`

## 任务

实现发消息、重新生成、续流、取消四个接口与完整回合：
1. 上下文构造：系统提示 + L4 画像（B3 前先返回空串）+ 当前分支路径消息 + 已启用插件工具 + Skill 名称与简介。路径计算统一调用 `server/app/branch/path.py`。
2. ReAct 工具循环（≤ 8 步）：内置工具 `search_materials`、`search_web`、`fetch_url`、`recall_memory`（B3 前返回空）、`open_source`、`load_skill`；每个返回片段登记为候选证据 E1…Ek 并发 `evidence` 事件。
3. 带引用生成：系统提示约束模型只能写本轮 `[[E#]]`；无依据的句子如何标注“推断”由你提出方案（写进契约并问我）。
4. 引用校验三关；判定写 citations 表；发 `citation` 事件。
5. 事件统一经 `server/app/agent/events.py` 发出：自动带 seq、写 message_events；`GET /events?after_seq=` 续流；`client_msg_id` 去重；`/cancel`。
6. 网页抓取：trafilatura 抽正文，存 web_snapshots，证据记录 `captured_in_message_id`。
7. 回合结束后把记忆抽取等任务写入 jobs（B3 实现处理逻辑）。

模型调用走 OpenAI 兼容适配层；单元测试用假模型，不访问网络。

## 验收

- SSE 顺序与 sse-events.md 完全一致（pytest 断言事件序列）。
- 断线续流、重复 client_msg_id、取消三种情况各有测试。
- 引用校验：构造支持、部分支持、不支持三种证据，判定正确。
- 前端去掉 MSW 后在真实后端完成一轮带证据的问答（截图）。

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建本地分支 `feat/B2-agent`（如果别的 Agent 也在这个仓库工作，用 git worktree）；完成后在本地提交，不 push、不改 remote、不 force。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
