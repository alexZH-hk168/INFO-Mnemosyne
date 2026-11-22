# 开发提示词

每个文件是一套可以直接粘贴给新 Agent 对话的完整提示词，对应 `docs/PROGRESS.md` 的一个里程碑。按依赖顺序发：F0 → F1 与 F2（可并行）→ F3 → F4 与 F6（可并行）→ F5 → B1 → B2 → B3；E 在 B1 后即可开始数据准备。

每套提示词都要求 Agent 先读 AGENTS.md、开发规范、进度看板和本里程碑的全部 UX 规格，完成时交回测试输出、截图和逐条验收结果。本目录由 `tools/uxgen/prompts.py` 生成，规格清单随规格自动更新。

| 里程碑 | 文件 | 规格数 | 分支 |
|---|---|---|---|
| F0 | [F0-scaffold.md](./F0-scaffold.md) | — | `feat/F0-scaffold` |
| F1 | [F1-shell.md](./F1-shell.md) | 20 | `feat/F1-shell` |
| F2 | [F2-home.md](./F2-home.md) | 6 | `feat/F2-home` |
| F3 | [F3-chat.md](./F3-chat.md) | 19 | `feat/F3-chat` |
| F4 | [F4-preview.md](./F4-preview.md) | 9 | `feat/F4-preview` |
| F5 | [F5-branch.md](./F5-branch.md) | 11 | `feat/F5-branch` |
| F6 | [F6-market.md](./F6-market.md) | 23 | `feat/F6-market` |
| B1 | [B1-ingest.md](./B1-ingest.md) | — | `feat/B1-ingest` |
| B2 | [B2-agent.md](./B2-agent.md) | — | `feat/B2-agent` |
| B3 | [B3-memory-plugins.md](./B3-memory-plugins.md) | — | `feat/B3-memory-plugins` |
| E1 | [E-eval.md](./E-eval.md) | — | `feat/E-eval` |

## 通用的“继续 / 返工”提示词

````text
继续 Mnemosyne 的 <里程碑> 开发。先读 docs/PROGRESS.md 的看板、未决和动作日志，以及你上次的分支 <分支名> 的提交记录，确认做到哪里；然后对照本里程碑规格的验收项，列出还没通过的，逐项完成。规则与完成时要交的东西同原提示词。
````

````text
对 Mnemosyne 的 <里程碑> 做独立验收，只读不改代码。读 AGENTS.md、docs/DEVELOPMENT.md 和该里程碑在 docs/ux/页面地图.md 中列出的全部规格；拉取分支 <分支名>，跑测试并截图，逐份规格逐条验收项给出 通过 / 不通过 / 未验证 和证据（测试名、截图路径、代码位置）。最后列出和规格、契约不一致的地方。
````
