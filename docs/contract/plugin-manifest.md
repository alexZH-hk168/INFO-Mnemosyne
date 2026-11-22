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
