# F1 外壳、项目栏、文件栏

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库在云电脑本地：`/home/user/workspace/INFO5000项目/INFO-Mnemosyne`（git，分支 main）。远端 GitHub 还没同步，不要从 https://github.com/alexZH-hk168/INFO-Mnemosyne 克隆，也不要 git push。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与分支规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
4. `docs/ux/README.md`、`docs/ux/state.md`、`docs/ux/页面地图.md`
5. 本里程碑的全部规格（20 份）：
- `docs/ux/specs/00-外壳/1-启动-应用外壳.md`
- `docs/ux/specs/00-外壳/1-外壳-分栏拖拽条.md`
- `docs/ux/specs/00-外壳/1-外壳-栏收起按钮.md`
- `docs/ux/specs/00-外壳/1-外壳-收起态竖条.md`
- `docs/ux/specs/00-外壳/1-外壳-全局快捷键.md`
- `docs/ux/specs/00-外壳/1-外壳-全局提示.md`
- `docs/ux/specs/01-项目栏/1-外壳-项目栏.md`
- `docs/ux/specs/01-项目栏/1-项目栏-新建对话按钮.md`
- `docs/ux/specs/01-项目栏/1-项目栏-新建项目按钮.md`
- `docs/ux/specs/01-项目栏/2-新建项目-新建项目弹窗.md`
- `docs/ux/specs/01-项目栏/1-项目栏-项目行.md`
- `docs/ux/specs/01-项目栏/1-项目行-对话行.md`
- `docs/ux/specs/01-项目栏/1-项目行-加载更多.md`
- `docs/ux/specs/01-项目栏/1-项目栏-用户卡片.md`
- `docs/ux/specs/02-文件栏/1-外壳-文件栏.md`
- `docs/ux/specs/02-文件栏/1-文件栏-上传按钮.md`
- `docs/ux/specs/02-文件栏/1-文件栏-拖拽上传区.md`
- `docs/ux/specs/02-文件栏/1-文件栏-文件分组.md`
- `docs/ux/specs/02-文件栏/1-文件分组-文件行.md`
- `docs/ux/specs/02-文件栏/1-文件行-解析失败重试.md`
6. 概念图 `docs/assets/ui/01-home.png`、`05-workspace-branch.png`、`06-workspace-evidence.png`

## 任务

实现应用外壳与左侧两栏：四栏布局（react-resizable-panels）、栏间拖拽、收起与竖条、快捷键、全局提示、项目栏（新建对话、插件与 Skill 入口、新建项目弹窗、项目行、对话行、加载更多、用户卡片）、文件栏（上传按钮、拖拽区、分组、文件行、解析失败重试、网页来源行）。中间区与右栏先放占位块（F2–F4 实现）。

注意：
- 收起按钮图标是用户指定的：圆角面板 + 竖分隔线 + 左侧两条短线（右栏用镜像版），参照 UI-05 每栏右上角的图标重画 SVG。
- 左侧栏不能出现“搜索”“长期记忆”入口。
- 数据全部来自 F0 的 MSW。

## 验收

- 截图与 UI-05 左两栏对齐（1440×900，允许 ±4 px）。
- 刷新后栏宽与收起状态保持；拖不出最小/最大宽度；双击拖拽条恢复默认。
- 上传 PDF 后文件行显示解析进度，MSW 模拟 3 s 后变为 ready。

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建本地分支 `feat/F1-shell`（如果别的 Agent 也在这个仓库工作，用 git worktree）；完成后在本地提交，不 push、不改 remote、不 force。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
