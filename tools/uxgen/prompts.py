# -*- coding: utf-8 -*-
# 生成 docs/prompts/*.md：每个里程碑一套可直接粘贴的提示词
import os, sys, collections
sys.path.insert(0, os.path.dirname(__file__))
import render  # noqa: 生成规格并做校验
from render import ALL, REPO, path_of

OUT = REPO + '/docs/prompts'
os.makedirs(OUT, exist_ok=True)
REPO_URL = 'https://github.com/alexZH-hk168/INFO-Mnemosyne'

COMMON_HEAD = f'''你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库在云电脑本地：`/home/user/workspace/INFO5000项目/INFO-Mnemosyne`（git，分支 main）。远端 GitHub 还没同步，不要从 {REPO_URL} 克隆，也不要 git push。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与分支规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
'''

COMMON_TAIL = '''
## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建本地分支 `{branch}`（如果别的 Agent 也在这个仓库工作，用 git worktree）；完成后在本地提交，不 push、不改 remote、不 force。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
'''

def spec_list(ms):
    items = [e for e in ALL if e.milestone == ms]
    return '\n'.join(f'- `{os.path.relpath(path_of(e), REPO)}`' for e in items), len(items)

PROMPTS = collections.OrderedDict()

PROMPTS['F0'] = dict(title='F0 契约样例与前端脚手架', branch='feat/F0-scaffold', body='''
4. `docs/contract/` 全部文件（README、rest-api、sse-events、data-model、evidence-locator、plugin-manifest、types.ts）
5. `docs/ux/README.md`、`docs/ux/state.md`

## 任务

1. **fixtures**：在 `docs/contract/fixtures/` 为 rest-api.md 里每个接口写一份成功样例与一份错误样例（JSON）；SSE 写一份完整回合 `sse-turn-full.json`（事件数组，含 step×3、evidence×3、delta 若干、citation×3，分别为 supported / partial / removed，最后 message.end）、一份取消回合、一份第 5 个事件后断线的续流回合。样例内容用“深度学习导论”项目：Attention Is All You Need 第 4 页脚注 4、课件 L05 第 18 页、jalammar.github.io 的网页、以及“反向传播 · 作业 3”历史对话（与概念图 UI-05/06 一致）。
2. **脚手架**：在 `web/` 用 Vite 建 React 18 + TypeScript 项目，配置 Tailwind、Zustand、TanStack Query、react-resizable-panels、framer-motion、MSW、Vitest、Playwright、ESLint、Prettier。
3. **tokens**：按 `docs/ux/README.md` 的设计 token 表写 `web/src/styles/tokens.css` 并接进 `tailwind.config.ts`；自托管字体 Inter、Noto Sans SC、Noto Serif SC。
4. **类型与 API 层**：`docs/contract/types.ts` 拷到 `web/src/api/types.ts`；写 `web/src/api/client.ts`（fetch 封装，统一解析错误体）、`web/src/api/queries.ts`（state.md 里全部 query key 的 hook，先只有签名和最简实现）、`web/src/api/sse.ts` 留空壳（F3 实现）。
5. **store 骨架**：`web/src/store/` 下 `layout.ts`、`chat.ts`、`evidence.ts`、`ui.ts`，字段与 action 名严格照 state.md，`layout` 持久化到 `mn.layout.v1`。
6. **MSW**：`web/src/mocks/handlers.ts` 读 fixtures 响应所有 REST 接口；SSE 用 ReadableStream 按 fixture 事件逐条推送（每条间隔 80 ms）。
7. **校验脚本**：`web/scripts/check-fixtures.ts`，用 types.ts 校验每份 fixture 的结构（可用 zod 或 ts-json-schema），加进 `npm run check`。
8. 首页先放一个占位页，能看到 tokens 生效即可。

## 验收

- `npm run dev` 起得来；`npm run check`、`npm test` 全绿。
- 每个 REST 接口在 MSW 下 fetch 得到 fixture；SSE fixture 能被逐条读到。
- 契约文件若需改动（发现字段缺失或矛盾），先列出来问我，确认后再改并在 PROGRESS 记“契约变更”。
''')

PROMPTS['F1'] = dict(title='F1 外壳、项目栏、文件栏', branch='feat/F1-shell', body='''
4. `docs/ux/README.md`、`docs/ux/state.md`、`docs/ux/页面地图.md`
5. 本里程碑的全部规格（{n} 份）：
{specs}
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
''')

PROMPTS['F2'] = dict(title='F2 主页与能力卡片', branch='feat/F2-home', body='''
4. `docs/ux/README.md`、`docs/ux/state.md`
5. 本里程碑的全部规格（{n} 份）：
{specs}
6. 概念图 `docs/assets/ui/01-home.png`～`04-card-slides.png`

## 任务

实现主页：标题“今天要学习什么？”、主页版输入框外观（发送逻辑由 F3 完成，本里程碑只要外观与聚焦）、三张扇形能力卡片、卡片介绍弹窗（含共享元素过渡、左右切换、焦点管理）。

动效要求（用户指定参考 ClawsGO 卡片）：
- 悬停：该卡抬起 12 px 并转正，另两张向两侧让开；用 framer-motion spring。
- 卡片封面内部循环小动画：论文页高亮从左向右扫过；代码逐行高亮；课件计算图上梯度箭头反向流动。周期 4–6 s。
- 点卡片：从原位放大成弹窗，背景毛玻璃；关闭沿原路径收回。
- `prefers-reduced-motion` 下只保留静态封面与透明度变化。

三张卡的标题与说明文案从 UI-02～04 原样抄到 `web/src/home/cards.ts`。“试一试”的示例材料还没定（PROGRESS 未决 U8），先实现为预填示例问题、不上传文件，并在代码里留 TODO 指向 U8。

## 验收

- 截图与 UI-01～04 对齐。
- 悬停与弹窗动画在 Chrome 性能面板中无长任务（> 50 ms）。
- 键盘：Tab 能依次聚焦三张卡，Enter 打开，←/→ 切换，Esc 关闭，焦点回到原卡片。
''')

PROMPTS['F3'] = dict(title='F3 输入框、对话流与证据胶囊', branch='feat/F3-chat', body='''
4. `docs/contract/sse-events.md`、`docs/contract/evidence-locator.md`、`docs/ux/state.md`
5. 本里程碑的全部规格（{n} 份）：
{specs}
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
''')

PROMPTS['F4'] = dict(title='F4 右栏与预览', branch='feat/F4-preview', body='''
4. `docs/contract/evidence-locator.md`、`docs/ux/state.md`
5. 本里程碑的全部规格（{n} 份）：
{specs}
6. 概念图 `docs/assets/ui/06-workspace-evidence.png`

## 任务

实现右栏：标签条、空态、证据栏（同一回答内左右切换证据）、PDF 预览（pdf.js 文本层 + 高亮层，跳页高亮 bbox，“证据 N”标签放在页边距外侧不压正文）、PDF 工具条、PPT 预览（复用 PDF 组件单页模式）、代码/Notebook/Markdown 预览（Shiki，滚到行高亮）、网页快照预览（纯文本渲染，不用 iframe——见未决 U6，如果用户改主意再换）、历史对话预览、插件结果卡片。

示例 PDF：在 `web/public/samples/` 放一份可公开分发的论文 PDF（arXiv 1706.03762，注明出处），让 MSW 的 `/api/documents/{did}/raw` 返回它；bbox 用 PyMuPDF 或 pdf.js 实测出第 4 页脚注 4 的坐标写进 fixture。

## 验收

- UI-06 复现：点“1 · p.4”胶囊，右栏跳到第 4 页并高亮脚注 4，证据栏显示“证据 1 · 第 4 页脚注 4 · 被主线第 1 条回答引用”。
- 代码胶囊 `L7` 滚到第 7 行；网页胶囊高亮 `char_range`。
- 右栏全程没有任何编辑入口。
''')

PROMPTS['F5'] = dict(title='F5 划词与分支对话', branch='feat/F5-branch', body='''
4. `docs/contract/rest-api.md` 的“分支”一节、`docs/contract/data-model.md` 的“分支可见性”一节、`docs/ux/state.md`
5. 本里程碑的全部规格（{n} 份）：
{specs}
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
''')

PROMPTS['F6'] = dict(title='F6 插件与 Skill 市场、设置', branch='feat/F6-market', body='''
4. `docs/contract/plugin-manifest.md`、`docs/contract/rest-api.md` 的“市场、插件与 Skill”和“设置与记忆”两节、`docs/ux/state.md`
5. 本里程碑的全部规格（{n} 份）：
{specs}
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
''')

PROMPTS['B1'] = dict(title='B1 后端：数据库、材料解析与检索', branch='feat/B1-ingest', body='''
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
''')

PROMPTS['B2'] = dict(title='B2 后端：Agent 主回路、SSE 与引用校验', branch='feat/B2-agent', body='''
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
''')

PROMPTS['B3'] = dict(title='B3 后端：长程记忆、分支隔离与插件运行时', branch='feat/B3-memory-plugins', body='''
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
''')

PROMPTS['E1'] = dict(title='E1+E2 评测：数据准备、跑分与指标', branch='feat/E-eval', body='''
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
''')

def build():
    idx = ['# 开发提示词', '',
           '每个文件是一套可以直接粘贴给新 Agent 对话的完整提示词，对应 `docs/PROGRESS.md` 的一个里程碑。按依赖顺序发：F0 → F1 与 F2（可并行）→ F3 → F4 与 F6（可并行）→ F5 → B1 → B2 → B3；E 在 B1 后即可开始数据准备。', '',
           '每套提示词都要求 Agent 先读 AGENTS.md、开发规范、进度看板和本里程碑的全部 UX 规格，完成时交回测试输出、截图和逐条验收结果。本目录由 `tools/uxgen/prompts.py` 生成，规格清单随规格自动更新。', '',
           '| 里程碑 | 文件 | 规格数 | 分支 |', '|---|---|---|---|']
    for ms, p in PROMPTS.items():
        specs, n = spec_list(ms) if ms.startswith('F') and ms != 'F0' else ('', 0)
        body = p['body'].replace('{specs}', specs).replace('{n}', str(n))
        text = COMMON_HEAD + body.lstrip('\n') + COMMON_TAIL.replace('{branch}', p['branch'])
        fn = p['branch'].split('/',1)[1] + '.md'
        open(f'{OUT}/{fn}', 'w', encoding='utf-8').write(f"# {p['title']}\n\n复制下面整段发给新的 Agent 对话。\n\n````text\n{text.strip()}\n````\n")
        idx.append(f"| {ms} | [{fn}](./{fn}) | {n or '—'} | `{p['branch']}` |")
    idx += ['', '## 通用的“继续 / 返工”提示词', '', '````text',
            '继续 Mnemosyne 的 <里程碑> 开发。先读 docs/PROGRESS.md 的看板、未决和动作日志，以及你上次的分支 <分支名> 的提交记录，确认做到哪里；然后对照本里程碑规格的验收项，列出还没通过的，逐项完成。规则与完成时要交的东西同原提示词。',
            '````', '', '````text',
            '对 Mnemosyne 的 <里程碑> 做独立验收，只读不改代码。读 AGENTS.md、docs/DEVELOPMENT.md 和该里程碑在 docs/ux/页面地图.md 中列出的全部规格；拉取分支 <分支名>，跑测试并截图，逐份规格逐条验收项给出 通过 / 不通过 / 未验证 和证据（测试名、截图路径、代码位置）。最后列出和规格、契约不一致的地方。',
            '````', '']
    open(f'{OUT}/README.md', 'w', encoding='utf-8').write('\n'.join(idx))
    print('prompts', len(PROMPTS))

build()
