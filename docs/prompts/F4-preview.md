# F4 右栏与预览

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库在云电脑本地：`/home/user/workspace/INFO5000项目/INFO-Mnemosyne`（git，分支 main）。远端 GitHub 还没同步，不要从 https://github.com/alexZH-hk168/INFO-Mnemosyne 克隆，也不要 git push。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与分支规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
4. `docs/contract/evidence-locator.md`、`docs/ux/state.md`
5. 本里程碑的全部规格（9 份）：
- `docs/ux/specs/06-右栏/1-外壳-右栏.md`
- `docs/ux/specs/06-右栏/1-右栏-标签条.md`
- `docs/ux/specs/06-右栏/2-预览-证据栏.md`
- `docs/ux/specs/06-右栏/2-证据胶囊-PDF预览.md`
- `docs/ux/specs/06-右栏/2-PDF预览-工具条.md`
- `docs/ux/specs/06-右栏/2-证据胶囊-PPT预览.md`
- `docs/ux/specs/06-右栏/2-文件行-代码预览.md`
- `docs/ux/specs/06-右栏/2-证据胶囊-网页快照预览.md`
- `docs/ux/specs/06-右栏/2-证据胶囊-历史对话预览.md`
6. 概念图 `docs/assets/ui/06-workspace-evidence.png`

## 任务

实现右栏：标签条、空态、证据栏（同一回答内左右切换证据）、PDF 预览（pdf.js 文本层 + 高亮层，跳页高亮 bbox，“证据 N”标签放在页边距外侧不压正文）、PDF 工具条、PPT 预览（复用 PDF 组件单页模式）、代码/Notebook/Markdown 预览（Shiki，滚到行高亮）、网页快照预览（纯文本渲染，不用 iframe——见未决 U6，如果用户改主意再换）、历史对话预览、插件结果卡片。

示例 PDF：在 `web/public/samples/` 放一份可公开分发的论文 PDF（arXiv 1706.03762，注明出处），让 MSW 的 `/api/documents/{did}/raw` 返回它；bbox 用 PyMuPDF 或 pdf.js 实测出第 4 页脚注 4 的坐标写进 fixture。

## 验收

- UI-06 复现：点“1 · p.4”胶囊，右栏跳到第 4 页并高亮脚注 4，证据栏显示“证据 1 · 第 4 页脚注 4 · 被主线第 1 条回答引用”。
- 代码胶囊 `L7` 滚到第 7 行；网页胶囊高亮 `char_range`。
- 右栏全程没有任何编辑入口。

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建本地分支 `feat/F4-preview`（如果别的 Agent 也在这个仓库工作，用 git worktree）；完成后在本地提交，不 push、不改 remote、不 force。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
