# Mnemosyne 后端（B1：数据库、材料解析与检索）

Python 3.11 + FastAPI，uv 管理依赖，SQLite（WAL）+ FTS5 + sqlite-vec。

```bash
cd server
uv sync                                   # 建 .venv 并安装依赖
uv run python scripts/init_db.py          # 建表（默认 data/mnemosyne.db）
uv run python scripts/fetch_test_data.py  # 下载测试论文 arXiv 1706.03762v7（不随仓库分发）
uv run pytest -q                          # 全部测试
uv run uvicorn app.main:app --port 8100   # 启动服务，解析任务在后台单线程执行
```

前端连真实后端：`cd web && MN_BACKEND=http://localhost:8100 npm run dev`（关闭 MSW，并把 `/api` 代理到 8100；不设该变量时仍走 MSW）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `MN_DATA_DIR` | `server/data` | 数据库与上传原件（`files/<doc_id>/`） |
| `MN_DB_PATH` | `$MN_DATA_DIR/mnemosyne.db` | 数据库文件 |
| `MN_WORKER` | `1` | `0` 关闭后台解析线程（测试用，改为同步跑队列） |
| `MN_SOFFICE` | `/usr/bin/soffice` | LibreOffice，PPTX 转预览 PDF |
| `MN_EMBED_BACKEND` | `fake` | `fake`：本地确定性假嵌入（哈希投影，256 维，不联网）；`openai`：OpenAI 兼容 `/v1/embeddings` |
| `MN_EMBED_API_BASE` | — | 如 `https://api.openai.com/v1` |
| `MN_EMBED_MODEL` | — | 如 `text-embedding-3-small` |
| `MN_EMBED_API_KEY` | — | 只从环境变量读取，不写日志 |
| `MN_EMBED_DIM` | fake 为 256 | 真实模型必须填，与模型输出维度一致 |

切到真实嵌入：设好上面四个 `MN_EMBED_*` 变量，然后运行 `uv run python scripts/ingest.py --project <项目> --reindex`，它会按新维度重建向量表并重新嵌入该项目全部材料（会产生嵌入 API 费用）。维度与现有向量表不一致时服务启动会报错并提示 `--reindex`。

## 目录

- `app/db/schema.sql`：按 `docs/contract/data-model.md` 建表；`chunks_vec` 由 `app/db/conn.py` 按嵌入维度建。
- `app/ingest/`：PDF（句子级 + bbox）、PPTX（文本框 + LibreOffice 转 PDF）、代码（函数/类 + 行号）、Notebook（单元格，不含输出）、Markdown；分块与任务流水线。
- `app/retrieval/`：嵌入适配层、混合检索（BM25 与向量各 50，RRF k=60，取前 8）、命中 → 证据。
- `app/branch/path.py`：分支路径可见性。
- `app/api/`：`projects.py`（项目与对话）、`materials.py`（材料、证据、网页快照）。
