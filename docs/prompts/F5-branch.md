# F5 划词与分支对话

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库：https://github.com/alexZH-hk168/INFO-Mnemosyne（分支 main）。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与推送规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
4. `docs/contract/rest-api.md` 的“分支”一节、`docs/contract/data-model.md` 的“分支可见性”一节、`docs/ux/state.md`
5. 本里程碑的全部规格（11 份）：
- `docs/ux/specs/05-对话栏/1-对话栏-分支概览标签.md`
- `docs/ux/specs/05-对话栏/1-助手回答-分支标记.md`
- `docs/ux/specs/05-对话栏/1-消息列表-合并卡片.md`
- `docs/ux/specs/05-对话栏/2-划词-划词工具条.md`
- `docs/ux/specs/05-对话栏/2-划词工具条-开分支追问.md`
- `docs/ux/specs/05-对话栏/2-划词工具条-引用.md`
- `docs/ux/specs/05-对话栏/2-划词工具条-复制.md`
- `docs/ux/specs/06-右栏/2-开分支追问-分支面板.md`
- `docs/ux/specs/06-右栏/2-分支面板-来源原句与回到原处.md`
- `docs/ux/specs/06-右栏/2-分支面板-上下文提示.md`
- `docs/ux/specs/06-右栏/2-分支面板-要点合并按钮.md`
6. 概念图 `docs/assets/ui/05-workspace-branch.png`、架构图 `docs/assets/arch/f5-branching.png`

## 任务

实现划词工具条（开分支追问、引用、复制）、分支面板（来源原句与回到原处、上下文提示、要点合并、分支输入框）、主线中的分支标记、分支概览标签、合并卡片，以及路由 `/c/:cid/b/:bid`。

关键点：
- 选区换算为去标记纯文本偏移；胶囊文字不计入选区和复制内容。
- 分支面板激活时 `useChat.activeBranchId` 为该分支，发送请求带 `branch_id`；切走恢复为 null。
- MSW 里实现 POST /api/branches 与 /merge：merge 返回一条 merge_note 消息并把分支置为 merged。

## 验收

- UI-05 复现：在“方差是 dk”处开分支，右栏出现分支并聚焦输入框，主线原句出现虚线下划线与“⑂ 分支”。
- 回到原处：主线滚到原句并闪烁高亮。
- 合并后主线末尾出现合并卡片，分支变只读。

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建分支 `feat/F5-branch`（用 git worktree，如果别的 Agent 也在这个仓库工作）；不直接推 main，不 force push。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
