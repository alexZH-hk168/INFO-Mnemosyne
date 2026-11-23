// 市场条目原始数据：由 03-调研/插件与Skill市场素材.json（GitHub 星数查询日 2026-11-21）机械转换，未增删条目、未改星数与许可证。
// 插件 id 为 manifest id、Skill id 为 SKILL.md 的 name（契约 v0.2，不加前缀）。
// installed 字段不在此处，由 fixtures-source.ts 按已安装列表补上。
import type { MarketItem } from '../api/types';

export const MARKET_DATA: Omit<MarketItem, 'installed'>[] = [
  {
    "id": "arxiv",
    "type": "plugin",
    "name": "ArXiv MCP Server",
    "owner": "blazickjp",
    "official": false,
    "stars": 3292,
    "stars_date": "2026-11-21",
    "license": "Apache-2.0",
    "category": "学术检索",
    "desc_zh": "查找 arXiv 预印本并读论文",
    "repo_url": "https://github.com/blazickjp/arxiv-mcp-server"
  },
  {
    "id": "paper-search",
    "type": "plugin",
    "name": "Paper Search MCP",
    "owner": "openags",
    "official": false,
    "stars": 3135,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "学术检索",
    "desc_zh": "跨 PubMed、学术搜索等来源查论文",
    "repo_url": "https://github.com/openags/paper-search-mcp"
  },
  {
    "id": "tavily",
    "type": "plugin",
    "name": "Tavily MCP",
    "owner": "tavily-ai",
    "official": true,
    "stars": 2500,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "网页检索与抓取",
    "desc_zh": "搜索网页并提取正文做资料摘录",
    "repo_url": "https://github.com/tavily-ai/tavily-mcp"
  },
  {
    "id": "exa",
    "type": "plugin",
    "name": "Exa MCP Server",
    "owner": "exa-labs",
    "official": true,
    "stars": 5251,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "网页检索与抓取",
    "desc_zh": "按语义搜索网页和学习资料",
    "repo_url": "https://github.com/exa-labs/exa-mcp-server"
  },
  {
    "id": "brave-search",
    "type": "plugin",
    "name": "Brave Search MCP Server",
    "owner": "brave",
    "official": true,
    "stars": 1585,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "网页检索与抓取",
    "desc_zh": "查找网页、新闻和视频资料",
    "repo_url": "https://github.com/brave/brave-search-mcp-server"
  },
  {
    "id": "fetch",
    "type": "plugin",
    "name": "Fetch MCP Server",
    "owner": "modelcontextprotocol",
    "official": true,
    "stars": 92139,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "网页检索与抓取",
    "desc_zh": "把网页正文转成便于阅读的文本",
    "repo_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch"
  },
  {
    "id": "zotero",
    "type": "plugin",
    "name": "Zotero MCP Plugin",
    "owner": "cookjohn",
    "official": false,
    "stars": 1288,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "文献管理",
    "desc_zh": "在 Zotero 文献库检索论文和笔记",
    "repo_url": "https://github.com/cookjohn/zotero-mcp"
  },
  {
    "id": "markitdown",
    "type": "plugin",
    "name": "MarkItDown MCP",
    "owner": "microsoft",
    "official": true,
    "stars": 197318,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "文档解析",
    "desc_zh": "把课程 PDF 和 Office 文档转为 Markdown",
    "repo_url": "https://github.com/microsoft/markitdown/tree/main/packages/markitdown-mcp"
  },
  {
    "id": "docling",
    "type": "plugin",
    "name": "Docling MCP",
    "owner": "docling-project",
    "official": true,
    "stars": 802,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "文档解析",
    "desc_zh": "提取课件和论文的文字与表格",
    "repo_url": "https://github.com/docling-project/docling-mcp"
  },
  {
    "id": "obsidian",
    "type": "plugin",
    "name": "Obsidian MCP",
    "owner": "MarkusPfundstein",
    "official": false,
    "stars": 4548,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "笔记与知识库",
    "desc_zh": "查找和整理 Obsidian 笔记",
    "repo_url": "https://github.com/MarkusPfundstein/mcp-obsidian"
  },
  {
    "id": "notion",
    "type": "plugin",
    "name": "Notion MCP Server",
    "owner": "makenotion",
    "official": true,
    "stars": 4720,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "笔记与知识库",
    "desc_zh": "搜索和整理 Notion 学习笔记",
    "repo_url": "https://github.com/makenotion/notion-mcp-server"
  },
  {
    "id": "anki",
    "type": "plugin",
    "name": "Anki MCP Server",
    "owner": "ankimcp",
    "official": false,
    "stars": 571,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "记忆卡片",
    "desc_zh": "将知识点做成 Anki 复习卡",
    "repo_url": "https://github.com/ankimcp/anki-mcp-server"
  },
  {
    "id": "jupyter",
    "type": "plugin",
    "name": "Jupyter MCP Server",
    "owner": "datalayer",
    "official": false,
    "stars": 1330,
    "stars_date": "2026-11-21",
    "license": "BSD-3-Clause",
    "category": "代码与 Notebook",
    "desc_zh": "在 Jupyter 运行单元格并查看结果",
    "repo_url": "https://github.com/datalayer/jupyter-mcp-server"
  },
  {
    "id": "github",
    "type": "plugin",
    "name": "GitHub MCP Server",
    "owner": "github",
    "official": true,
    "stars": 34636,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "代码与 Notebook",
    "desc_zh": "查找示例代码和项目资料",
    "repo_url": "https://github.com/github/github-mcp-server"
  },
  {
    "id": "youtube-transcript",
    "type": "plugin",
    "name": "YouTube Transcript MCP",
    "owner": "kimtaeyoon83",
    "official": false,
    "stars": 609,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "视频课程",
    "desc_zh": "提取 YouTube 课程字幕做笔记",
    "repo_url": "https://github.com/kimtaeyoon83/mcp-server-youtube-transcript"
  },
  {
    "id": "wikipedia",
    "type": "plugin",
    "name": "Wikipedia MCP",
    "owner": "Rudra-ravi",
    "official": false,
    "stars": 310,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "百科",
    "desc_zh": "查阅维基百科梳理概念背景",
    "repo_url": "https://github.com/Rudra-ravi/wikipedia-mcp"
  },
  {
    "id": "wolfram",
    "type": "plugin",
    "name": "Wolfram AgentTools",
    "owner": "WolframResearch",
    "official": true,
    "stars": 103,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "数学计算",
    "desc_zh": "用 Wolfram 语言验算数学题",
    "repo_url": "https://github.com/WolframResearch/AgentTools"
  },
  {
    "id": "context7",
    "type": "plugin",
    "name": "Context7",
    "owner": "upstash",
    "official": true,
    "stars": 65208,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "技术文档",
    "desc_zh": "按版本查找库文档和代码示例",
    "repo_url": "https://github.com/upstash/context7"
  },
  {
    "id": "pdf",
    "type": "skill",
    "name": "pdf",
    "owner": "anthropics",
    "official": true,
    "stars": 198229,
    "stars_date": "2026-11-21",
    "license": "Apache-2.0",
    "category": "PDF 阅读",
    "desc_zh": "提取论文 PDF 的文字与表格",
    "repo_url": "https://github.com/anthropics/skills/tree/main/skills/pdf"
  },
  {
    "id": "docx",
    "type": "skill",
    "name": "docx",
    "owner": "anthropics",
    "official": true,
    "stars": 198229,
    "stars_date": "2026-11-21",
    "license": "Apache-2.0",
    "category": "文档写作",
    "desc_zh": "撰写和修改课程报告",
    "repo_url": "https://github.com/anthropics/skills/tree/main/skills/docx"
  },
  {
    "id": "pptx",
    "type": "skill",
    "name": "pptx",
    "owner": "anthropics",
    "official": true,
    "stars": 198229,
    "stars_date": "2026-11-21",
    "license": "Apache-2.0",
    "category": "课件与演示",
    "desc_zh": "读取课件并制作课堂演示",
    "repo_url": "https://github.com/anthropics/skills/tree/main/skills/pptx"
  },
  {
    "id": "xlsx",
    "type": "skill",
    "name": "xlsx",
    "owner": "anthropics",
    "official": true,
    "stars": 198229,
    "stars_date": "2026-11-21",
    "license": "Apache-2.0",
    "category": "表格与数据",
    "desc_zh": "用表格整理作业数据和公式",
    "repo_url": "https://github.com/anthropics/skills/tree/main/skills/xlsx"
  },
  {
    "id": "skill-creator",
    "type": "skill",
    "name": "skill-creator",
    "owner": "anthropics",
    "official": true,
    "stars": 198229,
    "stars_date": "2026-11-21",
    "license": "Apache-2.0",
    "category": "技能制作",
    "desc_zh": "把反复使用的学习步骤做成技能",
    "repo_url": "https://github.com/anthropics/skills/tree/main/skills/skill-creator"
  },
  {
    "id": "literature-review",
    "type": "skill",
    "name": "literature-review",
    "owner": "K-Dense-AI",
    "official": false,
    "stars": 57979,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "文献综述",
    "desc_zh": "检索筛选论文并整理综述证据",
    "repo_url": "https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/literature-review"
  },
  {
    "id": "scientific-writing",
    "type": "skill",
    "name": "scientific-writing",
    "owner": "K-Dense-AI",
    "official": false,
    "stars": 57979,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "科研写作",
    "desc_zh": "按论文结构组织研究报告",
    "repo_url": "https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/scientific-writing"
  },
  {
    "id": "peer-review",
    "type": "skill",
    "name": "peer-review",
    "owner": "K-Dense-AI",
    "official": false,
    "stars": 57979,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "批判性阅读",
    "desc_zh": "检查论文的方法、证据和结论",
    "repo_url": "https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/peer-review"
  },
  {
    "id": "research-lookup",
    "type": "skill",
    "name": "research-lookup",
    "owner": "K-Dense-AI",
    "official": false,
    "stars": 57979,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "科研查证",
    "desc_zh": "查找论文与研究事实的出处",
    "repo_url": "https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/research-lookup"
  },
  {
    "id": "citation-management",
    "type": "skill",
    "name": "citation-management",
    "owner": "K-Dense-AI",
    "official": false,
    "stars": 57979,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "引用管理",
    "desc_zh": "核对文献引用并整理书目",
    "repo_url": "https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/citation-management"
  },
  {
    "id": "writing-plans",
    "type": "skill",
    "name": "writing-plans",
    "owner": "obra",
    "official": false,
    "stars": 323266,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "编程学习",
    "desc_zh": "把编程练习拆成可验证的小步骤",
    "repo_url": "https://github.com/obra/superpowers/tree/main/skills/writing-plans"
  },
  {
    "id": "brainstorming",
    "type": "skill",
    "name": "brainstorming",
    "owner": "obra",
    "official": false,
    "stars": 323266,
    "stars_date": "2026-11-21",
    "license": "MIT",
    "category": "项目构思",
    "desc_zh": "澄清课程项目目标并比较方案",
    "repo_url": "https://github.com/obra/superpowers/tree/main/skills/brainstorming"
  }
];

/**
 * F6b 追加（契约 v0.5 并行草案 `short_name?`，原 U36）：18 个插件的简称，输入框插件胶囊用。
 * 与后端 B3b 的 server/registry/plugins.json（分支 feat/B3b-plugins 5dbcbce）逐条一致：arxiv、fetch、markitdown 取自 UX 规格
 * （UI-11 托条“网页检索 · PDF 解析 · arXiv”），其余 15 个由 B3b 拟定，待用户确认（编排 2026-11-23）。
 */
export const PLUGIN_SHORT_NAMES: Record<string, string> = {
  arxiv: 'arXiv',
  'paper-search': '论文检索',
  tavily: 'Tavily 检索',
  exa: 'Exa 检索',
  'brave-search': 'Brave 检索',
  fetch: '网页检索',
  zotero: 'Zotero',
  markitdown: 'PDF 解析',
  docling: 'Docling 解析',
  obsidian: 'Obsidian',
  notion: 'Notion',
  anki: 'Anki',
  jupyter: 'Jupyter',
  github: 'GitHub',
  'youtube-transcript': 'YouTube 字幕',
  wikipedia: '维基百科',
  wolfram: 'Wolfram',
  context7: '技术文档',
};

/**
 * F6b 追加（编排决定，来自 B3b 的 U92）：第一版有 Mnemosyne 适配清单（mnemosyne-plugin.json）的插件只有这 4 个，
 * 其余 14 个后端安装返回 400 VALIDATION_ERROR，前端安装按钮置灰。启动信息照抄 B3b 的 server/registry/plugins.json
 * （transport、command、args、tools_allow）；arxiv 的详情 fixture 自 F6 起已有 manifest（args 未锁版本，见 PROGRESS），这里不重复。
 */
export const PLUGIN_MANIFESTS: Record<
  string,
  { transport: 'stdio' | 'http'; command: string; args: string[]; tools_allow?: string[] }
> = {
  tavily: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'tavily-mcp@0.2.22'],
    tools_allow: ['tavily-search', 'tavily-extract'],
  },
  fetch: { transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch@2026.11.18'], tools_allow: ['fetch'] },
  markitdown: {
    transport: 'stdio',
    command: 'uvx',
    args: ['markitdown-mcp@0.0.1a8'],
    tools_allow: ['convert_to_markdown'],
  },
};

/** B3b 对未适配插件安装请求的错误文案（server/app/plugins/runtime.py） */
export const notAdaptedMessage = (id: string) => `插件 ${id} 还没有 Mnemosyne 适配清单，暂时不能安装`;

/** 插件条目带上简称（Skill 不加） */
export function withShortName<T extends { id: string }>(type: 'plugin' | 'skill', item: T): T & { short_name?: string } {
  const short = type === 'plugin' ? PLUGIN_SHORT_NAMES[item.id] : undefined;
  return short ? { ...item, short_name: short } : item;
}
