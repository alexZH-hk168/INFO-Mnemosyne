# 插件、Skill 与市场

## 插件 manifest（`mnemosyne-plugin.json`）

```json
{
  "id": "arxiv",
  "name": "ArXiv MCP Server",
  "version": "1.0.0",
  "source_url": "https://github.com/blazickjp/arxiv-mcp-server",
  "license": "Apache-2.0",
  "transport": "stdio",
  "command": "uvx",
  "args": ["arxiv-mcp-server", "--storage-path", "~/.mnemosyne/plugins/arxiv"],
  "env_schema": {},
  "permissions": ["network", "fs_write"],
  "tools_allow": ["search_papers", "get_abstract", "download_paper", "read_paper"],
  "evidence_mapping": { "title": "$.title", "url": "$.pdf_url", "quote": "$.summary" }
}
```

| 字段 | 说明 |
|---|---|
| id / name / version | 唯一标识、显示名、Mnemosyne 侧适配清单版本（不代表上游版本） |
| source_url / license | GitHub 地址与许可证 |
| transport | `stdio`（`uvx`/`npx` 拉起）或 `http` |
| command / args | 启动命令 |
| env_schema | `{ KEY: { required: bool, secret: bool, label } }` |
| permissions | `network`、`fs_read`、`fs_write`、`exec`；安装时展示，v1 不强制执行 |
| tools_allow | 只把这些工具暴露给模型；省略＝全部 |
| evidence_mapping | 工具结果 → 证据字段的 JSON 路径；接入时按真实返回结构确认 |

运行时：每插件一个 MCP 会话，空闲 10 分钟回收；工具名加命名空间 `arxiv__search_papers`；单次调用超时 30 s。

**v1 完整验收只做 ArXiv MCP Server 与 Fetch MCP Server**（固定版本、能安装、能调用、结果能转成证据）。其他市场条目只展示，安装按钮可用但标“未验收”。

## Skill

- 一个目录，根下必须有 `SKILL.md`，YAML 头部必须有 `name` 与 `description`（`license` 可选）。
- 渐进加载：系统提示只放全部已启用 Skill 的 `name + description`；模型调 `load_skill(name)` 取正文；正文引用的文件再按需读取。
- 用户在输入框键入 `/name` 强制本轮加载（SSE 里出现 `kind=load_skill` 的 step）。
- 附带脚本 v1 不执行。

## 市场 registry

`server/registry/plugins.json`、`server/registry/skills.json`，由 `build_registry.py` 从调研清单生成。字段：`id, type, name, owner, official, stars, stars_date, license, category, desc_zh, repo_url, manifest?`。首批 18 个插件、12 个 Skill，星数查询日 2026-11-21；合集仓库与子目录条目显示的是所属仓库星数。

类别（插件）：学术检索、网页检索与抓取、文献管理、文档解析、笔记与知识库、记忆卡片、代码与 Notebook、视频课程、百科、数学计算、技术文档。
类别（Skill）：PDF 阅读、文档写作、课件与演示、表格与数据、技能制作、文献综述、科研写作、批判性阅读、科研查证、引用管理、编程学习、项目构思。

## B3b 实现约定（v0.5 草案 [B3b]，编排统一后定稿）

**固定版本**（2026-11-23 按 PyPI / npm 官方页面核对的最新版，写在 `server/registry/sources/manifests/<id>.json` 的 `args` 里）：

| 插件 | 启动 | 验收 |
|---|---|---|
| arxiv | `uvx arxiv-mcp-server@0.8.2 --storage-path ~/.mnemosyne/plugins/arxiv` | v1 完整验收（真实安装待磁盘问题解决后由编排做） |
| fetch | `uvx mcp-server-fetch@2026.11.18` | 同上 |
| markitdown | `uvx markitdown-mcp@0.0.1a8` | 未验收 |
| tavily | `npx -y tavily-mcp@0.2.22`（需 `TAVILY_API_KEY`） | 未验收 |

其余 14 个市场条目没有适配清单：只展示，`POST /api/plugins/{id}` 返回 `VALIDATION_ERROR`（未决 U92）。

**evidence_mapping 写法**：键 `title`、`url`、`quote`（必需），可选 `items`；值是路径字符串或路径数组（取第一个非空值）。
含 `{$…}` 的字符串是模板（F6b 对齐时加），如 `"arXiv:{$.paper_id} · {$.title}"`，任一占位取不到值则跳到数组下一项。
`$` 是当前记录，`$.a.b`、`$.a[0]` 逐级取；`$args.x` 取本次调用参数；`$text` 取工具返回的全部文本。`items` 指向记录列表
（如 arXiv `search_papers` 的 `$.papers`），取不到数组时整个结果当一条记录（如 `get_abstract`）。结果先取 MCP 的
structuredContent，否则把文本当 JSON 解析。每次调用最多 5 条证据。

- arxiv：`{"items": "$.papers", "title": ["arXiv:{$.paper_id} · {$.title}", "arXiv:{$.id} · {$.title}", "$.title"], "url": "$.url", "quote": ["$.abstract", "$.summary"]}`（按 v0.8.2 源码 `tools/search.py`、`tools/get_abstract.py` 的返回结构确认）。`search_papers` 的记录有 `url` → 网页快照；`get_abstract` 只有 `pdf_url`，不取它 → 无 URL 插件证据（右栏题录卡片），与 F6b 的 `get-evidence-eid.plugin.ok.json` 一致（F6b 对齐时把 `url` 从 `["$.url", "$.pdf_url"]` 改成 `"$.url"`）。
- fetch：`{"title": "$args.url", "url": "$args.url", "quote": "$text"}`。

**证据落库**：记录有 http(s) URL → 运行时写一条 `web_snapshots`（`text` = 标题 + 空行 + 引文全文，`http_status` 记 200），
返回 `EvidenceDraft(kind="web", source_id=snapshot_id, locator={snapshot_id, char_range})`；快照内容来自插件返回，
不是 Mnemosyne 另行抓取的页面（未决 U91）。没有 URL → `kind="plugin"`，`locator={plugin_id, tool_name, fields}`；`fields` 里字符串截到 2000 字，数字、布尔、空值和标量数组（如作者列表）原样保留，其余嵌套结构转 JSON 文本。插件证据标题不入库，`GET /api/evidence/{eid}` 对 `fields` 重新套清单的 title 映射，与回合里 SSE `evidence` 事件的标题一致（F6b 对齐）。
`evidence` 行（含 `captured_in_message_id`）由 B2 写。

**运行时**：后台线程持有全部会话，legacy `initialize` 握手；空闲 `MN_PLUGIN_IDLE_S`（默认 600 s）回收；
启动 + `tools/list` 自检上限 `MN_PLUGIN_START_TIMEOUT_S`（默认 30 s）；单次调用超时默认 30 s，超时的 `ToolResult`
`is_error=true`、文本以 `PLUGIN_TIMEOUT` 开头。配置项以环境变量注入插件进程，密钥值加密存进 `config_json`
（密钥文件 `<data_dir>/secret.key`）。子进程额外继承代理与 uv/npm 镜像相关环境变量。

**registry 额外字段**：`plugins.json` 每项另有 `verified`、`short_name?`、`manifest?`，以及详情页用的
`tools?`、`about_zh?`、`usage_zh?`、`permission_notes?`。条目 id 与简称来自 `server/registry/sources/overlay.json`，
其余市场字段只来自调研 JSON。
