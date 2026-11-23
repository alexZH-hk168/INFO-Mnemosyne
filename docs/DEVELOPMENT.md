# 开发规范

本文件规定怎么干活。项目是什么、红线有哪些见根目录 [AGENTS.md](../AGENTS.md)。

## 1. 每个任务的 7 步

1. **读**：AGENTS.md、本文件、PROGRESS.md、本任务涉及的每份 UX 规格（页面地图里按里程碑列着）、相关契约文件。
2. **认领**：在 PROGRESS.md 看板把该里程碑改为“进行中”，写上分支名与日期；在动作日志加一条“开始”。
3. **对照**：把规格的“下一级”表逐行列成待办；规格引用的 store 字段、query key、接口在 `docs/ux/state.md` 与 `docs/contract/` 里都找得到才开始写。找不到 → 第 3 条红线。
4. **实现**：一个规格对应一个组件（或一个组件内的明确区块），文件顶部注释写规格名，如 `// 规格：1-助手回答-证据胶囊（chat.evidence-chip）`。
5. **测试**：见第 3 节。
6. **截图对照**：用 Playwright 在 1440×900 下截图，存 `web/tests/screenshots/<规格名>.png`，与概念图并排检查；没有概念图的规格，截图交用户确认。
7. **记录**：更新 PROGRESS.md（看板状态、动作日志、新的未决）；勾选规格里已通过的验收项（只改 `tools/uxgen/specs_*.py` 后重新生成，或在 PR 描述里逐条列出）。

## 2. 代码约定

### 前端

- 目录与组件路径以每份规格的“建议组件”为准；共享逻辑放 `web/src/lib/`。
- 类型从 `docs/contract/types.ts` 拷到 `web/src/api/types.ts`，两处保持一致；字段保持 `snake_case`。
- 服务端数据只走 TanStack Query（key 见 state.md）；界面状态只走 Zustand 的四个 store；不另建全局 store。
- 样式用 Tailwind，颜色、圆角、字体只引用 `tokens.css` 里的变量。
- 每个可交互元素带 `data-testid`（= 规格 ID），列表项加 `:{id}`。
- 可访问性：可点元素用 `<button>`/`<a>`；弹窗锁焦点、Esc 关闭、关闭后焦点回到触发元素；动效遵守 `prefers-reduced-motion`。
- 不引入规格没要求的 UI 库（组件库、图标库）。图标自绘 SVG 放 `web/src/icons/`。

### 后端

- 路由文件按 `docs/contract/rest-api.md` 分组：`server/app/api/<分组>.py`；请求与响应用 Pydantic 模型，字段与契约一一对应。
- 所有“当前分支路径可见性”判断集中在 `server/app/branch/path.py`，检索、记忆召回、`open_source`、快照读取都调用它，不各写一套。
- SSE 事件全部经 `server/app/agent/events.py` 发出，自动带 `seq` 并写入 `message_events` 以支持续流。
- 模型调用经一个适配层（OpenAI 兼容），测试里用假模型返回固定输出，单元测试不访问网络。

### 共通

- 命名：Python `snake_case`，TS 组件 `PascalCase`、函数 `camelCase`，JSON 字段 `snake_case`。
- 提交说明：`[里程碑] 规格名或模块：做了什么`，如 `[F3] 1-助手回答-证据胶囊：按 verdict 渲染四种状态`。

## 3. 测试与验收

| 层 | 工具 | 至少要有 |
|---|---|---|
| 前端单元 | Vitest + Testing Library | 每份规格“状态”表里的每个状态一条渲染测试 |
| 前端端到端 | Playwright（跑在 MSW 上） | 每份规格“下一级”表的每一行一条交互测试；页面截图 |
| 后端 | pytest | 每个接口成功/失败各一条；SSE 顺序与续流；分支可见性三组用例（合并前兄弟不可见、合并后对主线可见、按 ID 越权被拒） |
| 契约 | 脚本对比 | MSW handler 与后端路由都用 `docs/contract/fixtures/` 校验响应结构 |

“完成”的定义：该里程碑所有规格的验收项都勾上，测试全绿，截图已存并对照过。只完成一部分时看板写“部分完成”并列出剩余项。

## 4. 分支、并行与推送

- 主分支 `main` 只接受合并。每个里程碑一个分支：`feat/F3-chat-stream`、`feat/B2-agent-loop`。
- 多个 Agent 并行时，每人一个 `git worktree`；前端 dev server 端口按里程碑错开（F1 5171、F2 5172 …），避免撞号。
- 共享文件（`docs/contract/*`、`web/src/api/types.ts`、`web/src/store/*`、`tokens.css`）同一时间只允许一个分支修改，修改前在看板“共享文件锁”一栏登记。
- 推送：开发 Agent 只在本地分支提交，不 push。编排 Agent 每次合并本地 `main` 并复跑测试后，把 `main` 推送到 `alexZH-hk168/INFO-Mnemosyne`（用户 2026-11-23 要求及时同步；只 fast-forward，禁止 force；推送前先 fetch 核对）。不在仓库或聊天里写任何令牌。

## 5. 动作日志格式

PROGRESS.md 的动作日志每条一行：

```text
- 2026-11-23 14:20 · [F1] 1-外壳-分栏拖拽条 · 完成 · 分支 feat/F1-shell · 测试 12/12 · 截图 web/tests/screenshots/1-外壳-分栏拖拽条.png
```

状态只用：开始、完成、部分完成、阻塞（写原因）、契约变更（写改了什么）。

## 6. 遇到问题时

- 规格缺口、契约不一致、需要新接口：记“未决”，问用户，不自行决定。
- 第三方插件（MCP Server）行为与 README 不符：以实测为准，在 `plugin-manifest.md` 的条目下记录，并更新 manifest。
- 同一处尝试 2–3 次仍失败：停下，在日志里写清现象、已试过的办法和猜测，交回给用户。
