# F3 输入框、对话流与证据胶囊

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库在云电脑本地：`/home/user/workspace/INFO5000项目/INFO-Mnemosyne`（git，分支 main）。远端 GitHub 还没同步，不要从 https://github.com/alexZH-hk168/INFO-Mnemosyne 克隆，也不要 git push。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与分支规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
4. `docs/contract/sse-events.md`、`docs/contract/evidence-locator.md`、`docs/ux/state.md`
5. 本里程碑的全部规格（19 份）：
- `docs/ux/specs/02-文件栏/1-文件分组-网页来源行.md`
- `docs/ux/specs/04-输入框/1-外壳-输入框.md`
- `docs/ux/specs/04-输入框/1-输入框-发送停止按钮.md`
- `docs/ux/specs/04-输入框/1-输入框-联网检索开关.md`
- `docs/ux/specs/04-输入框/1-输入框-引用范围.md`
- `docs/ux/specs/04-输入框/1-输入框-附件按钮.md`
- `docs/ux/specs/04-输入框/1-输入框-模型档位.md`
- `docs/ux/specs/04-输入框/2-艾特-文件引用列表.md`
- `docs/ux/specs/05-对话栏/1-对话行-对话栏.md`
- `docs/ux/specs/05-对话栏/1-对话栏-消息列表.md`
- `docs/ux/specs/05-对话栏/1-消息列表-用户消息.md`
- `docs/ux/specs/05-对话栏/1-消息列表-助手回答.md`
- `docs/ux/specs/05-对话栏/1-助手回答-步骤行.md`
- `docs/ux/specs/05-对话栏/1-助手回答-证据胶囊.md`
- `docs/ux/specs/05-对话栏/2-证据胶囊-原句浮层.md`
- `docs/ux/specs/05-对话栏/1-助手回答-推断标记.md`
- `docs/ux/specs/05-对话栏/1-助手回答-来源列表.md`
- `docs/ux/specs/05-对话栏/1-助手回答-重新生成与切换.md`
- `docs/ux/specs/05-对话栏/1-对话栏-流式连接.md`
6. 概念图 `docs/assets/ui/05-workspace-branch.png`、`06-workspace-evidence.png`、`11-plugin-popover.png`

## 任务

实现输入框（三种 variant、发送/停止、联网检索、引用范围、附件、模型档位、@ 文件引用；`/` Skill 列表的数据部分留给 F6，本里程碑做出列表外观与插入逻辑）、对话栏、消息列表、用户消息、助手回答（Markdown + KaTeX）、步骤行、证据胶囊与原句浮层、推断标记、来源列表、重新生成与兄弟切换、SSE 客户端（含断线续流与 client_msg_id 去重）。

关键点：
- 所有句子偏移、锚点偏移都按“去掉 `[[E#]]` 后的纯文本”计算（契约规定），写一个 `stripCitations()` 与偏移换算工具并单测。
- 胶囊四种状态：待确认（虚线 60%）、supported、partial（句末“推断”）、removed（不渲染）。
- 步骤行里记忆相关步骤只说“参考 N 段历史对话”，不出现“记忆”二字。
- 证据胶囊点击只需调用 `useEvidence.select` 并打开右栏标签，预览内容由 F4 实现（先显示占位）。

## 验收

- MSW 完整回合：步骤 → 证据 → 正文 → 引用确认 → 保存，渲染与 UI-05 中间栏第一条回答一致。
- 取消回合：回答保留，未确认胶囊变“推断”。
- 断线回合：续流后内容完整、无重复字符。
- 主线与分支草稿互不覆盖（分支 variant 用 mock 分支 id 测）。

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建本地分支 `feat/F3-chat`（如果别的 Agent 也在这个仓库工作，用 git worktree）；完成后在本地提交，不 push、不改 remote、不 force。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
