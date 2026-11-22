# B3 后端：长程记忆、分支隔离与插件运行时

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库在云电脑本地：`/home/user/workspace/INFO5000项目/INFO-Mnemosyne`（git，分支 main）。远端 GitHub 还没同步，不要从 https://github.com/alexZH-hk168/INFO-Mnemosyne 克隆，也不要 git push。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与分支规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
4. `docs/contract/data-model.md`（重点“分支可见性”）、`plugin-manifest.md`、`rest-api.md` 的“分支”“市场、插件与 Skill”“设置与记忆”
5. 架构图 `docs/assets/arch/f3-memory.png`、`f5-branching.png`、`f6-plugins-skills.png`

## 任务

1. **长程记忆**：jobs worker 处理 `extract_memory`（小模型抽取 knowledge / misconception / progress / preference 候选）→ 与同主题前 5 条比对判 ADD / UPDATE / SUPERSEDE / NOOP → 写 memory_items 与 topics/*.md → 按规则重写 L2 摘要与 L4 画像（保留版本号）。`recall_memory` 混合检索 L3 与 L2，按作用域与当前路径过滤。删除条目进 memory_blocklist，抽取时跳过。`/api/memory/*` 接口。
2. **分支**：`POST /api/branches`、`/merge`（模型总结要点、插入 merge_note、分支条目升 project 作用域、status=merged）。分支可见性 5 条规则全部在 `branch/path.py` 实现，并写三组必测用例：合并前兄弟分支互不可见；合并后条目对主线可见；按 ID 调 `open_source` 访问路径外消息返回 `NOT_VISIBLE_ON_PATH`。
3. **插件运行时**：官方 mcp Python SDK；每插件一个会话，stdio（uvx/npx）或 http；空闲 10 分钟回收；工具名 `插件id__工具名`；单次 30 s 超时；结果按 evidence_mapping 转证据。安装接口做启动 + tools/list 自检。**只对 ArXiv MCP Server 与 Fetch MCP Server 做完整验收**（固定版本号写进 manifest）。
4. **Skill**：导入（GitHub 目录或本机路径，校验 SKILL.md 头部）、启用开关、渐进加载 `load_skill`、`forced_skill`。附带脚本不执行。
5. `scripts/build_registry.py` 从调研清单生成 `server/registry/*.json`。

## 验收

- 三组分支隔离用例通过。
- 构造“用户先说喜欢 A、后来改成 B”的对话，记忆中 A 被 SUPERSEDE，问“我以前喜欢什么”能答 A 并带有效期。
- 在真实环境装上 ArXiv 插件，问一个 arXiv 检索问题，回答带蓝色证据胶囊且能打开快照。

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建本地分支 `feat/B3-memory-plugins`（如果别的 Agent 也在这个仓库工作，用 git worktree）；完成后在本地提交，不 push、不改 remote、不 force。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
