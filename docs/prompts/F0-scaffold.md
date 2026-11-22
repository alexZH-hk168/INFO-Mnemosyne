# F0 契约样例与前端脚手架

复制下面整段发给新的 Agent 对话。

````text
你在开发 Mnemosyne（INFO5000 课程项目，一个带长程记忆、证据追踪、分支对话和插件市场的学习助手）。仓库在云电脑本地：`/home/user/workspace/INFO5000项目/INFO-Mnemosyne`（git，分支 main）。远端 GitHub 还没同步，不要从 https://github.com/alexZH-hk168/INFO-Mnemosyne 克隆，也不要 git push。用中文和我沟通。

开工前按顺序完整读完这些文件，没读完不要改代码：
1. `AGENTS.md`（红线与产品口径）
2. `docs/DEVELOPMENT.md`（7 步流程、代码约定、测试与分支规则）
3. `docs/PROGRESS.md`（看板、未决；确认本里程碑的依赖已完成、没人认领）
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

## 规则

- 每个组件对应上面列出的一份规格；规格里的“上一级 / 下一级 / 接口 / 状态 / 验收”逐条实现。
- 接口与字段只按 `docs/contract/`；规格写不清、和契约冲突、或你想加规格里没有的东西：停下，在 `docs/PROGRESS.md`“未决”加一条，然后问我。
- 代码全新写，不从任何其他项目拷代码；新增第三方库在提交说明里写库名和许可证。
- 新建本地分支 `feat/F0-scaffold`（如果别的 Agent 也在这个仓库工作，用 git worktree）；完成后在本地提交，不 push、不改 remote、不 force。
- 不要说没跑过的测试“通过了”，不要说没截图的界面“完成了”。

## 完成时交给我

1. 改动文件清单与分支名。
2. 测试命令与真实输出（通过数 / 总数）。
3. 截图路径（`web/tests/screenshots/<规格名>.png`），以及与概念图的差异说明。
4. 每份规格的验收项：已通过 / 未通过 / 未验证。
5. 新增的“未决”条目。
6. 已更新 `docs/PROGRESS.md`（看板状态与动作日志）。
````
