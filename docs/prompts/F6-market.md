# F6 插件与 Skill 市场、设置

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库在云电脑本地：`/home/user/workspace/INFO5000项目/INFO-Mnemosyne`（git，分支 main）。远端 GitHub 还没同步，不要从 https://github.com/alexZH-hk168/INFO-Mnemosyne 克隆，也不要 git push。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与分支规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
4. `docs/contract/plugin-manifest.md`、`docs/contract/rest-api.md` 的“市场、插件与 Skill”和“设置与记忆”两节、`docs/ux/state.md`
5. 本里程碑的全部规格（23 份）：
- `docs/ux/specs/01-项目栏/1-项目栏-插件与Skill入口.md`
- `docs/ux/specs/08-设置/2-用户卡片-设置弹窗.md`
- `docs/ux/specs/08-设置/3-设置-记忆管理.md`
- `docs/ux/specs/04-输入框/1-输入框-插件区入口.md`
- `docs/ux/specs/04-输入框/2-斜杠-Skill选择列表.md`
- `docs/ux/specs/06-右栏/2-证据胶囊-插件结果卡片.md`
- `docs/ux/specs/07-市场/2-插件与Skill-市场页.md`
- `docs/ux/specs/07-市场/2-市场页-标签切换.md`
- `docs/ux/specs/07-市场/2-市场页-搜索框.md`
- `docs/ux/specs/07-市场/2-市场页-类别筛选.md`
- `docs/ux/specs/07-市场/2-市场页-排序.md`
- `docs/ux/specs/07-市场/2-市场页-条目卡片.md`
- `docs/ux/specs/07-市场/2-条目卡片-安装按钮.md`
- `docs/ux/specs/07-市场/3-安装-安装确认弹窗.md`
- `docs/ux/specs/07-市场/3-条目卡片-插件详情页.md`
- `docs/ux/specs/07-市场/3-插件详情-工具列表.md`
- `docs/ux/specs/07-市场/3-插件详情-配置卡.md`
- `docs/ux/specs/07-市场/3-插件详情-卸载.md`
- `docs/ux/specs/07-市场/3-条目卡片-Skill详情页.md`
- `docs/ux/specs/07-市场/2-市场页-导入Skill.md`
- `docs/ux/specs/07-市场/2-插件区-会话插件弹层.md`
- `docs/ux/specs/07-市场/2-会话插件弹层-插件开关.md`
- `docs/ux/specs/07-市场/2-会话插件弹层-去插件市场.md`
6. 概念图 `docs/assets/ui/07-market-plugins.png`～`11-plugin-popover.png`

## 任务

实现市场页（标签、搜索、类别、排序、卡片网格、导入 Skill）、插件详情（工具表、配置卡、权限卡、来源卡、卸载）、Skill 详情、安装按钮与三步安装弹窗、会话插件弹层与开关、输入框 `/` Skill 列表的数据接入、设置弹窗与记忆管理页。

数据：
- 市场条目的权威来源是飞书立项稿 §10.4 的表（18 个插件、12 个 Skill，星数查询日 2026-11-21）。在 `docs/contract/fixtures/market-plugins.json`、`market-skills.json` 里照抄，不要自己编条目、星数或许可证。
- ArXiv MCP Server 详情的 19 个工具名以其 GitHub README 为准（search_papers、get_abstract、download_paper、list_papers、read_paper、get_paper_outline、read_paper_section、search_paper_text、citation_graph、export_citations、watch_topic、list_watches、check_alerts、unwatch_topic、semantic_search、reindex，以及 get_paper_latex 系列，实现前打开 README 核对一遍）。
- 权限卡最后一行固定“以上为插件自行声明，第一版不做沙箱隔离”。只有 ArXiv 与 Fetch 标“已验收”，其余标“未验收”。

设置弹窗与记忆页、安装弹窗没有概念图（未决 U7）：先实现并截图，交给我确认后再定稿。

## 验收

- UI-07～11 复现。
- 安装成功与自检失败两条路径在 MSW 下都能走通。
- 删除记忆条目有二次确认，确认文案说明“原始对话仍保留”。

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建本地分支 `feat/F6-market`（如果别的 Agent 也在这个仓库工作，用 git worktree）；完成后在本地提交，不 push、不改 remote、不 force。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
