// F6 单元测试（Vitest + Testing Library，跑在 MSW 有状态市场层上）：每份规格「状态」表的每个状态至少一条。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import FourPane from '../layout/FourPane';
import { setMockScenario } from '../mocks/handlers';
import { MARKET_DATA } from '../mocks/market-data';
import { goMarket } from '../lib/nav';
import { useChat } from '../store/chat';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';
import {
  categoriesOf,
  filterItems,
  formatStarsFull,
  formatStarsShort,
  initials,
  matchesQuery,
  sortItems,
} from './format';
import { headingsOf, highlight, parseBlocks, splitFrontMatter } from './markdownParse';
import { readParams, paramsSearch } from './marketNav';
import { renderWithClient, server, setupMarketMsw, setViewport } from './test-utils';

setupMarketMsw();

const plugins = MARKET_DATA.filter((m) => m.type === 'plugin').map((m) => ({ ...m, installed: false }));
const skills = MARKET_DATA.filter((m) => m.type === 'skill').map((m) => ({ ...m, installed: false }));

function openMarket(path: string) {
  window.history.replaceState(null, '', path);
  return renderWithClient(<FourPane />);
}

async function cards() {
  const grid = await screen.findByTestId('market.grid');
  return within(grid)
    .getAllByTestId(/^market\.card:/)
    .map((el) => el.getAttribute('data-testid')!.slice('market.card:'.length));
}

describe('format（纯函数）', () => {
  it('星数：卡片短格式与千分位', () => {
    expect(formatStarsShort(3292)).toBe('3.3k');
    expect(formatStarsShort(92139)).toBe('92k');
    expect(formatStarsShort(571)).toBe('571');
    expect(formatStarsShort(2500)).toBe('2.5k');
    expect(formatStarsFull(3292)).toBe('3,292');
  });
  it('首字母色块', () => {
    expect(initials('ArXiv MCP Server')).toBe('Ar');
    expect(initials('pdf')).toBe('Pd');
    expect(initials('literature-review')).toBe('Li');
  });
  it('搜索 arxiv 只剩 ArXiv MCP Server；中英文、大小写都匹配', () => {
    expect(filterItems(plugins, 'arxiv', null, 'recommended').map((i) => i.id)).toEqual(['arxiv']);
    expect(filterItems(plugins, 'ARXIV', null, 'recommended').map((i) => i.id)).toEqual(['arxiv']);
    expect(matchesQuery(plugins[0], '预印本')).toBe(true);
    expect(matchesQuery(plugins[0], '学术检索')).toBe(true);
    expect(matchesQuery(plugins[0], 'blazickjp')).toBe(true);
  });
  it('类别去重保序；选“学术检索”只剩该类', () => {
    expect(categoriesOf(plugins)).toEqual([
      '学术检索',
      '网页检索与抓取',
      '文献管理',
      '文档解析',
      '笔记与知识库',
      '记忆卡片',
      '代码与 Notebook',
      '视频课程',
      '百科',
      '数学计算',
      '技术文档',
    ]);
    expect(filterItems(plugins, '', '学术检索', 'recommended').map((i) => i.id)).toEqual(['arxiv', 'paper-search']);
  });
  it('排序：推荐＝原顺序，按星数降序，按名称', () => {
    expect(sortItems(plugins, 'recommended')).toBe(plugins);
    const byStars = sortItems(plugins, 'stars').map((i) => i.stars);
    expect(byStars).toEqual([...byStars].sort((a, b) => b - a));
    expect(sortItems(plugins, 'stars')[0].id).toBe('markitdown');
    expect(sortItems(skills, 'name')[0].id).toBe('brainstorming');
  });
  it('URL 查询串读写', () => {
    expect(readParams('?q=arxiv&cat=%E5%AD%A6%E6%9C%AF%E6%A3%80%E7%B4%A2&sort=stars')).toEqual({
      q: 'arxiv',
      cat: '学术检索',
      sort: 'stars',
    });
    expect(readParams('?sort=bad').sort).toBe('recommended');
    expect(paramsSearch({ q: '', cat: null, sort: 'recommended' })).toBe('');
  });
});

describe('Markdown（SKILL.md 预览）', () => {
  const md =
    '---\nname: pdf\ndescription: d\nlicense: MIT\n---\n# Guide\n## Overview\ntext **b**\n## Python\n### pypdf\n```python\nimport x  # c\nprint("hi")\n```\n- a\n- b\n';
  it('拆出 YAML 头部', () => {
    const { front, body } = splitFrontMatter(md);
    expect(front?.fields).toEqual({ name: 'pdf', description: 'd', license: 'MIT' });
    expect(body.startsWith('# Guide')).toBe(true);
  });
  it('块与目录', () => {
    const { body } = splitFrontMatter(md);
    expect(parseBlocks(body).map((b) => b.kind)).toEqual([
      'heading',
      'heading',
      'para',
      'heading',
      'heading',
      'code',
      'list',
    ]);
    expect(headingsOf(body).map((h) => `${h.level}${h.text}`)).toEqual(['1Guide', '2Overview', '2Python', '3pypdf']);
  });
  it('代码高亮：关键字、字符串、注释、函数名', () => {
    const { container } = renderWithClient(<code>{highlight('import x  # c\nprint("hi")', 'python')}</code>);
    const spans = [...container.querySelectorAll('span')].map((s) => s.textContent);
    expect(spans).toEqual(expect.arrayContaining(['import', '# c', 'print', '"hi"']));
  });
});

describe('2-插件与Skill-市场页', () => {
  it('市场页占据中间区与右栏位置：文件栏、右栏隐藏，项目栏保留；离开后恢复', async () => {
    openMarket('/market/plugins');
    expect(await screen.findByTestId('market.page')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar.market-entry')).toBeInTheDocument();
    expect(screen.queryByTestId('files.panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('right.placeholder')).not.toBeInTheDocument();
    act(() => useLayout.getState().setView('home'));
    expect(await screen.findByTestId('right.placeholder')).toBeInTheDocument();
    expect(useLayout.getState().collapsed).toEqual([false, false, false, false]);
  });

  it('加载中：卡片骨架 6 张', async () => {
    server.use(http.get('*/api/market/plugins', () => new Promise(() => {})));
    openMarket('/market/plugins');
    const loading = await screen.findByTestId('market.page.loading');
    expect(within(loading).getAllByTestId('market.card-skeleton')).toHaveLength(6);
  });

  it('请求失败：“市场数据加载失败 · 重试”，重试后恢复', async () => {
    setMockScenario('GET /api/market/plugins', 'error');
    openMarket('/market/plugins');
    const err = await screen.findByTestId('market.page.error', {}, { timeout: 4000 });
    expect(err).toHaveTextContent('市场数据加载失败 ·');
    setMockScenario('GET /api/market/plugins', 'ok');
    server.use(http.get('*/api/market/plugins', () => HttpResponse.json({ items: plugins })));
    fireEvent.click(screen.getByTestId('market.page.retry'));
    expect(await cards()).toHaveLength(18);
  });

  it('18 个插件、12 个 Skill 的字段与 registry 一致', async () => {
    openMarket('/market/plugins');
    expect(await cards()).toEqual(plugins.map((p) => p.id));
    for (const p of plugins) {
      const card = screen.getByTestId(`market.card:${p.id}`);
      expect(within(card).getByTestId('market.card.name')).toHaveTextContent(p.name);
      expect(within(card).getByTestId('market.card.owner')).toHaveTextContent(p.owner);
      expect(within(card).getByTestId('market.card.desc')).toHaveTextContent(p.desc_zh);
      expect(within(card).getByTestId('market.card.license')).toHaveTextContent(p.license);
      expect(within(card).getByTestId('market.card.stars')).toHaveAttribute(
        'title',
        `${formatStarsFull(p.stars)} · 所属仓库星数，查询于 2026-11-21`,
      );
      expect(within(card).getByText(p.official ? '官方' : '社区')).toBeInTheDocument();
      expect(within(card).getByText(p.category)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId('market.tabs:skills'));
    await waitFor(async () => expect(await cards()).toEqual(skills.map((s) => s.id)));
    expect(screen.getByTestId('market.page.footer')).toHaveTextContent('共 12 个 Skill');
  });

  it('网格：宽 ≥ 1280 三列，否则两列', async () => {
    openMarket('/market/plugins');
    expect(await screen.findByTestId('market.grid')).toHaveAttribute('data-cols', '3');
    act(() => setViewport(1200));
    await waitFor(() => expect(screen.getByTestId('market.grid')).toHaveAttribute('data-cols', '2'));
  });

  it('筛选无结果：“没有匹配的条目”＋清空筛选', async () => {
    openMarket('/market/plugins?q=zzzz-none');
    const empty = await screen.findByTestId('market.page.empty');
    expect(empty).toHaveTextContent('没有匹配的条目');
    fireEvent.click(screen.getByTestId('market.page.clear-filters'));
    expect(await cards()).toHaveLength(18);
    expect(window.location.search).toBe('');
  });

  it('已安装标签：插件 + Skill 共 5 项', async () => {
    openMarket('/market/installed');
    expect(await cards()).toEqual(['arxiv', 'fetch', 'markitdown', 'pdf', 'literature-review']);
    expect(screen.getByTestId('market.tabs:installed')).toHaveTextContent('5');
  });
});

describe('2-市场页-标签切换 / 搜索框 / 类别筛选 / 排序', () => {
  it('激活标签下划线；切换改路由 /market/:tab，保留搜索词、清空类别', async () => {
    openMarket('/market/plugins?q=mcp&cat=%E5%AD%A6%E6%9C%AF%E6%A3%80%E7%B4%A2');
    await cards();
    expect(screen.getByTestId('market.tabs:plugins')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('market.tabs:skills'));
    expect(useLayout.getState().marketRoute).toEqual({ tab: 'skills' });
    expect(window.location.pathname).toBe('/market/skills');
    expect(window.location.search).toBe('?q=mcp');
    expect(screen.getByTestId('market.tabs:skills')).toHaveAttribute('aria-selected', 'true');
  });

  it('输入 arxiv 150 ms 防抖后只剩 ArXiv MCP Server，写入 ?q=；× 清空', async () => {
    openMarket('/market/plugins');
    await cards();
    fireEvent.change(screen.getByTestId('market.search'), { target: { value: 'arxiv' } });
    expect(await cards()).toHaveLength(18); // 防抖期间不变
    await waitFor(async () => expect(await cards()).toEqual(['arxiv']));
    expect(window.location.search).toBe('?q=arxiv');
    fireEvent.click(screen.getByTestId('market.search.clear'));
    expect(await cards()).toHaveLength(18);
  });

  it('选“学术检索”只剩该类（实心胶囊）；再点取消', async () => {
    openMarket('/market/plugins');
    await cards();
    const chip = screen.getByTestId('market.category:学术检索');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(await cards()).toEqual(['arxiv', 'paper-search']);
    expect(new URLSearchParams(window.location.search).get('cat')).toBe('学术检索');
    fireEvent.click(chip);
    expect(await cards()).toHaveLength(18);
  });

  it('排序默认“推荐排序”；选“按星数”后降序', async () => {
    openMarket('/market/plugins');
    await cards();
    expect(screen.getByTestId('market.sort')).toHaveTextContent('推荐排序');
    fireEvent.click(screen.getByTestId('market.sort'));
    fireEvent.click(screen.getByTestId('market.sort:stars'));
    const ids = await cards();
    const stars = ids.map((id) => plugins.find((p) => p.id === id)!.stars);
    expect(stars).toEqual([...stars].sort((a, b) => b - a));
    expect(window.location.search).toBe('?sort=stars');
  });
});

describe('2-市场页-条目卡片 / 2-条目卡片-安装按钮', () => {
  it('installed → “已安装 ✓”；官方小标签；未验收插件旁小字“未验收”（ArXiv、Fetch 除外）', async () => {
    openMarket('/market/plugins');
    await cards();
    expect(screen.getByTestId('market.install-button:arxiv')).toHaveTextContent('已安装 ✓');
    expect(screen.getByTestId('market.install-button:tavily')).toHaveTextContent('安装');
    expect(screen.queryByTestId('market.install-button.unverified:arxiv')).not.toBeInTheDocument();
    expect(screen.queryByTestId('market.install-button.unverified:fetch')).not.toBeInTheDocument();
    expect(screen.getByTestId('market.install-button.unverified:tavily')).toHaveTextContent('未验收');
  });

  it('点卡片主体进入详情（路由 /market/:type/:id）；已安装按钮也进详情', async () => {
    openMarket('/market/plugins');
    await cards();
    fireEvent.click(screen.getByTestId('market.card.open:tavily'));
    expect(useLayout.getState().marketRoute).toEqual({ tab: 'plugins', detail: { type: 'plugin', id: 'tavily' } });
    expect(window.location.pathname).toBe('/market/plugin/tavily');
    expect(await screen.findByTestId('market.plugin-detail')).toBeInTheDocument();
  });

  it('插件：点安装打开安装确认弹窗 useUI.openModal("install", {pluginId})，不进详情', async () => {
    openMarket('/market/plugins');
    await cards();
    fireEvent.click(screen.getByTestId('market.install-button:tavily'));
    expect(useUI.getState().modal).toEqual({ kind: 'install', props: { pluginId: 'tavily' } });
    expect(useLayout.getState().marketRoute.detail).toBeUndefined();
    expect(await screen.findByTestId('market.install-dialog')).toBeInTheDocument();
  });

  it('Skill：点安装直接导入，安装中转圈，之后卡片变“已安装”', async () => {
    openMarket('/market/skills');
    await cards();
    const btn = screen.getByTestId('market.install-button:docx');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('data-state', 'busy'));
    expect(btn).toHaveTextContent('导入中');
    await waitFor(() => expect(screen.getByTestId('market.install-button:docx')).toHaveTextContent('已安装 ✓'));
    expect(screen.getByTestId('market.tabs:installed')).toHaveTextContent('6');
  });

  it('在对话上下文中：已安装且本对话已启用 → “已安装 · 本对话已启用”', async () => {
    act(() => useChat.getState().setConversation('cnv_transformer'));
    openMarket('/market/plugins');
    await cards();
    await waitFor(() =>
      expect(screen.getByTestId('market.install-button:arxiv')).toHaveTextContent('已安装 · 本对话已启用'),
    );
  });
});

describe('3-安装-安装确认弹窗', () => {
  async function openInstall(id: string) {
    openMarket('/market/plugins');
    await cards();
    const btn = screen.getByTestId(`market.install-button:${id}`);
    btn.focus(); // 浏览器里点击会把焦点放到按钮上，jsdom 不会
    fireEvent.click(btn);
    return screen.findByTestId('market.install-dialog');
  }

  it('① 权限确认：逐项列出声明的权限并注明不做沙箱 → ② 填配置（密钥用密码框）→ ③ 成功', async () => {
    await openInstall('tavily');
    const perms = await screen.findByTestId('market.install-dialog.permissions');
    expect(within(perms).getByTestId('market.install-dialog.permission:network')).toHaveTextContent('联网');
    expect(perms).toHaveTextContent('以上为插件自行声明，第一版不做沙箱隔离');
    expect(screen.getByTestId('market.install-dialog.unverified')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('market.install-dialog.next'));
    const key = await screen.findByTestId('market.install-dialog.field:TAVILY_API_KEY');
    expect(key).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('market.install-dialog.next')).toBeDisabled();
    fireEvent.change(key, { target: { value: 'tvly-test' } });
    fireEvent.click(screen.getByTestId('market.install-dialog.next'));
    expect(await screen.findByTestId('market.install-dialog.checking')).toHaveTextContent('正在启动并检查工具…');
    await waitFor(() => expect(screen.queryByTestId('market.install-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('market.install-button:tavily')).toHaveTextContent('已安装'));
  });

  it('无需配置：跳过第 ② 步；成功且有当前对话时追加到本对话启用列表', async () => {
    act(() => useChat.getState().setConversation('cnv_transformer'));
    await openInstall('paper-search');
    const steps = await screen.findByTestId('market.install-dialog.steps');
    await waitFor(() => expect(steps).toHaveTextContent('无需配置'));
    expect(screen.getByTestId('market.install-dialog.next')).toHaveTextContent('安装');
    fireEvent.click(screen.getByTestId('market.install-dialog.next'));
    await waitFor(() => expect(screen.queryByTestId('market.install-dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId('market.install-button:paper-search')).toHaveTextContent('已安装 · 本对话已启用'),
    );
  });

  it('自检失败：红色原因 +“查看日志”展开 log_tail +“重试”', async () => {
    await openInstall('docling');
    await screen.findByTestId('market.install-dialog.permissions');
    fireEvent.click(screen.getByTestId('market.install-dialog.next'));
    const failed = await screen.findByTestId('market.install-dialog.failed');
    expect(failed).toHaveTextContent('tools/list 在 30 s 内没有返回');
    fireEvent.click(screen.getByTestId('market.install-dialog.show-log'));
    expect(screen.getByTestId('market.install-dialog.log')).toHaveTextContent(
      '[mnemosyne] tools/list timed out after 30000 ms',
    );
    fireEvent.click(screen.getByTestId('market.install-dialog.retry'));
    expect(await screen.findByTestId('market.install-dialog.checking')).toBeInTheDocument();
    expect(await screen.findByTestId('market.install-dialog.failed')).toBeInTheDocument();
  });

  it('取消 / Esc 关闭，焦点回到触发按钮', async () => {
    const dialog = await openInstall('tavily');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(useUI.getState().modal).toBeNull();
    await waitFor(() => expect(screen.getByTestId('market.install-button:tavily')).toHaveFocus());
  });
});

describe('3-条目卡片-插件详情页 / 工具列表 / 配置卡 / 卸载', () => {
  it('ArXiv：上游 19 个工具，默认 8 个，其余折叠为“还有 … 等 11 个”，展开显示全部', async () => {
    openMarket('/market/plugin/arxiv');
    const tools = await screen.findByTestId('market.plugin-tools');
    expect(within(tools).getAllByTestId(/^market\.plugin-tools\.row:/)).toHaveLength(8);
    const more = screen.getByTestId('market.plugin-tools.more');
    expect(more).toHaveTextContent(/还有 list_papers、read_paper、.* 等 11 个/);
    fireEvent.click(more);
    expect(within(tools).getAllByTestId(/^market\.plugin-tools\.row:/)).toHaveLength(19);
    expect(screen.getByTestId('market.plugin-detail.verified')).toHaveTextContent('已验收');
  });

  it('权限卡最后一行固定；来源卡；配置卡“此插件不需要 API Key。”；已安装右上“已安装”', async () => {
    openMarket('/market/plugin/arxiv');
    const perms = await screen.findByTestId('market.plugin-detail.permissions');
    const items = within(perms).getAllByRole('listitem');
    expect(items[items.length - 1]).toHaveTextContent('以上为插件自行声明，第一版不做沙箱隔离');
    expect(screen.getByTestId('market.plugin-detail.source')).toHaveTextContent(
      'github.com/blazickjp/arxiv-mcp-server',
    );
    expect(screen.getByTestId('market.plugin-detail.source')).toHaveTextContent('3,292（2026-11-21）');
    expect(screen.getByTestId('market.plugin-config.no-key')).toHaveTextContent('此插件不需要 API Key。');
    expect(screen.getByTestId('market.install-button')).toHaveTextContent('已安装');
  });

  it('未安装：右上“安装”；配置卡列出 Key 字段；未验收', async () => {
    openMarket('/market/plugin/tavily');
    expect(await screen.findByTestId('market.install-button')).toHaveTextContent('安装');
    expect(screen.getByTestId('market.plugin-config.field:TAVILY_API_KEY')).toHaveTextContent('安装时填写');
    expect(screen.getByTestId('market.plugin-detail.verified')).toHaveTextContent('未验收');
    expect(screen.queryByTestId('market.uninstall')).not.toBeInTheDocument();
  });

  it('status=error：顶部红色条 +“重新检查”调用 POST /api/plugins/{id}', async () => {
    let posted = false;
    server.use(
      http.get('*/api/plugins/arxiv', () =>
        HttpResponse.json({
          id: 'arxiv',
          name: 'ArXiv MCP Server',
          version: '1.0.0',
          status: posted ? 'installed' : 'error',
          permissions: ['network'],
          config_schema: {},
          tools: [],
          verified: true,
        }),
      ),
      http.post('*/api/plugins/arxiv', () => {
        posted = true;
        return HttpResponse.json({
          id: 'arxiv',
          name: 'ArXiv MCP Server',
          version: '1.0.0',
          status: 'installed',
          permissions: [],
          config_schema: {},
        });
      }),
    );
    openMarket('/market/plugin/arxiv');
    const bar = await screen.findByTestId('market.plugin-detail.error-bar');
    expect(bar).toHaveTextContent('自检失败');
    fireEvent.click(screen.getByTestId('market.plugin-detail.recheck'));
    await waitFor(() => expect(screen.queryByTestId('market.plugin-detail.error-bar')).not.toBeInTheDocument());
    expect(posted).toBe(true);
  });

  it('配置卡：修改并保存 → 重新自检（密钥不回显，保存后只显示“已设置”）', async () => {
    openMarket('/market/plugin/tavily');
    // 先装上
    fireEvent.click(await screen.findByTestId('market.install-button'));
    fireEvent.click(await screen.findByTestId('market.install-dialog.next'));
    fireEvent.change(await screen.findByTestId('market.install-dialog.field:TAVILY_API_KEY'), {
      target: { value: 'k1' },
    });
    fireEvent.click(screen.getByTestId('market.install-dialog.next'));
    await waitFor(() => expect(screen.queryByTestId('market.install-dialog')).not.toBeInTheDocument());
    fireEvent.click(await screen.findByTestId('market.plugin-config.edit'));
    const input = screen.getByTestId('market.plugin-config.input:TAVILY_API_KEY');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'k2' } });
    fireEvent.click(screen.getByTestId('market.plugin-config.save'));
    await waitFor(() =>
      expect(screen.getByTestId('market.plugin-config.field:TAVILY_API_KEY')).toHaveTextContent('已设置'),
    );
  });

  it('卸载：二次确认后 DELETE，卡片回到“安装”，项目栏数字即时更新', async () => {
    openMarket('/market/plugin/markitdown');
    const count = await screen.findByTestId('sidebar.market-entry.count');
    await waitFor(() => expect(count).toHaveTextContent('4'));
    fireEvent.click(await screen.findByTestId('market.uninstall'));
    const confirm = await screen.findByTestId('market.uninstall.confirm');
    expect(confirm).toHaveTextContent('已经产生的证据与网页快照会保留');
    fireEvent.click(within(confirm).getByTestId('market.uninstall.ok'));
    await waitFor(() => expect(screen.queryByTestId('market.uninstall.confirm')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('sidebar.market-entry.count')).toHaveTextContent('3'));
    fireEvent.click(screen.getByTestId('market.breadcrumbs.tab'));
    await cards();
    expect(screen.getByTestId('market.install-button:markitdown')).toHaveTextContent('安装');
  });

  it('面包屑回市场列表（marketRoute.detail=undefined），恢复列表查询串', async () => {
    openMarket('/market/plugins?q=arxiv');
    await waitFor(async () => expect(await cards()).toEqual(['arxiv']));
    fireEvent.click(screen.getByTestId('market.card.open:arxiv'));
    await screen.findByTestId('market.plugin-detail');
    fireEvent.click(screen.getByTestId('market.breadcrumbs.tab'));
    expect(useLayout.getState().marketRoute).toEqual({ tab: 'plugins' });
    expect(`${window.location.pathname}${window.location.search}`).toBe('/market/plugins?q=arxiv');
    expect(await cards()).toEqual(['arxiv']);
  });
});

describe('3-条目卡片-Skill详情页', () => {
  it('已安装：SKILL.md 头部 + 正文、附带文件、加载方式；启用开关 PUT /api/skills/{id}', async () => {
    openMarket('/market/skill/pdf');
    const md = await screen.findByTestId('market.skill-detail.md');
    expect(within(md).getByTestId('market.skill-detail.md.frontmatter')).toHaveTextContent('name: pdf');
    expect(screen.getByTestId('market.skill-detail.files')).toHaveTextContent('LICENSE.txt');
    expect(screen.getByTestId('market.skill-detail.loading-mode')).toHaveTextContent('/pdf');
    const sw = screen.getByTestId('market.skill-detail.toggle');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() =>
      expect(screen.getByTestId('market.skill-detail.toggle')).toHaveAttribute('aria-checked', 'false'),
    );
    // 停用后项目栏数字少 1（只数已启用 Skill）
    await waitFor(() => expect(screen.getByTestId('sidebar.market-entry.count')).toHaveTextContent('3'));
  });

  it('未安装：只显示简介（registry 无 SKILL.md 缓存），右上“安装”', async () => {
    openMarket('/market/skill/docx');
    expect(await screen.findByTestId('market.skill-detail.no-preview')).toBeInTheDocument();
    expect(screen.getByTestId('market.install-button')).toHaveTextContent('安装');
    expect(screen.queryByTestId('market.skill-detail.toggle')).not.toBeInTheDocument();
  });

  it('附带脚本在文件列表里标“不执行”', async () => {
    server.use(
      http.get('*/api/skills/pdf', () =>
        HttpResponse.json({
          id: 'pdf',
          name: 'pdf',
          description: 'd',
          dir_path: '~/.mnemosyne/skills/pdf',
          enabled: true,
          skill_md: '---\nname: pdf\ndescription: d\n---\n',
          files: ['SKILL.md', 'scripts/fill.py'],
        }),
      ),
    );
    openMarket('/market/skill/pdf');
    const file = await screen.findByTestId('market.skill-detail.file:scripts/fill.py');
    expect(file).toHaveTextContent('不执行');
    expect(screen.getByTestId('market.skill-detail.file:SKILL.md')).not.toHaveTextContent('不执行');
  });
});

describe('2-市场页-导入Skill', () => {
  it('只在 Skill 标签显示“导入”；GitHub 目录导入成功后加入已安装', async () => {
    openMarket('/market/plugins');
    await cards();
    expect(screen.queryByTestId('market.import-skill')).not.toBeInTheDocument();
    act(() => goMarket({ tab: 'skills' }));
    fireEvent.click(await screen.findByTestId('market.import-skill'));
    fireEvent.change(screen.getByTestId('market.import-skill.input'), {
      target: { value: 'https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/peer-review' },
    });
    fireEvent.click(screen.getByTestId('market.import-skill.submit'));
    await waitFor(() => expect(screen.queryByTestId('market.import-skill.dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('market.install-button:peer-review')).toHaveTextContent('已安装'));
  });

  it('导入 anthropics/skills 的 pdf 目录成功（已存在时返回原条目）', async () => {
    openMarket('/market/skills');
    fireEvent.click(await screen.findByTestId('market.import-skill'));
    fireEvent.change(screen.getByTestId('market.import-skill.input'), {
      target: { value: 'https://github.com/anthropics/skills/tree/main/skills/pdf' },
    });
    fireEvent.click(screen.getByTestId('market.import-skill.submit'));
    await waitFor(() => expect(screen.queryByTestId('market.import-skill.dialog')).not.toBeInTheDocument());
    expect(useUI.getState().toasts.at(-1)?.text).toBe('已导入 Skill「pdf」');
  });

  it('校验失败：输入框下红字（SKILL_INVALID 显示缺哪个字段）', async () => {
    openMarket('/market/skills');
    fireEvent.click(await screen.findByTestId('market.import-skill'));
    fireEvent.click(screen.getByTestId('market.import-skill.source:local'));
    fireEvent.change(screen.getByTestId('market.import-skill.input'), { target: { value: '~/skills/my-notes' } });
    fireEvent.click(screen.getByTestId('market.import-skill.submit'));
    expect(await screen.findByTestId('market.import-skill.error')).toHaveTextContent('SKILL.md 头部缺少 description');
    expect(screen.getByTestId('market.import-skill.input')).toHaveAttribute('aria-invalid', 'true');
  });
});
