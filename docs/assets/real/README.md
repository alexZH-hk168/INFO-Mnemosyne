# 真实运行截图（假模型）

由 `web/tests/e2e-real/smoke.real.spec.ts` 连真实 FastAPI 后端截取（1440×900），后端用确定性假模型（`MN_LLM_BACKEND=fake`），回答文字是模板，不是真实模型输出。INT2（2026-11-23）从 `web/tests/screenshots-real/` 复制：

| 文件 | 来源 |
|---|---|
| 01-answer-evidence.png | 04-回答-步骤行与证据胶囊.png |
| 02-evidence-pdf-highlight.png | 06-证据胶囊-PDF第4页高亮.png |
| 03-branch-follow-up.png | 10-分支-追问回答.png |
| 04-branch-merged.png | 11-分支-要点合并到主线.png |
| 05-market.png | 12-市场页.png |
| 06-composer-plugins.png | 15-输入框插件区-对话.png（插件是挂在 ArXiv 条目下的本地假 MCP 服务） |
