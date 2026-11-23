// F6 端到端测试（Playwright，跑在 MSW 上）：每份规格「下一级」表的每一行一条交互测试，并按规格名截图（1440×900）。
import { expect, test, type Page } from '@playwright/test';
import { mock, openApp, shot } from './f1-helpers';

async function openMarket(page: Page, path = '/market/plugins') {
  await openApp(page, path);
  await mock(page, 'resetMarketWorld');
  await mock(page, 'setSelfCheckMs', 1200);
  await expect(page.getByTestId('market.page')).toBeVisible();
}

const cardIds = async (page: Page) =>
  page
    .getByTestId('market.grid')
    .locator('[data-testid^="market.card:"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice('market.card:'.length)));

test('1-项目栏-插件与Skill入口：点击切到 /market/plugins，行高亮；安装/卸载后数字即时更新', async ({ page }) => {
  await openApp(page, '/');
  await mock(page, 'resetMarketWorld');
  await mock(page, 'setSelfCheckMs', 300);
  const entry = page.getByTestId('sidebar.market-entry');
  await expect(entry.getByTestId('sidebar.market-entry.count')).toHaveText('4');
  await entry.click();
  await expect(page).toHaveURL(/\/market\/plugins$/);
  await expect(entry).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('files.panel')).toHaveCount(0);
  await shot(page, '1-项目栏-插件与Skill入口');
  // F6b：第一版只有 4 个插件有适配清单（B3b U92），先卸载 Fetch 再装回来，看数字 4 → 3 → 4
  // （MarkItDown 是自检失败样例，装回会失败）
  await page.getByTestId('market.card.open:fetch').click();
  await page.getByTestId('market.uninstall').click();
  await page.getByTestId('market.uninstall.ok').click();
  await expect(entry.getByTestId('sidebar.market-entry.count')).toHaveText('3');
  await page.getByTestId('market.install-button').click();
  await page.getByTestId('market.install-dialog.next').click();
  await expect(page.getByTestId('market.install-dialog')).toHaveCount(0);
  await expect(entry.getByTestId('sidebar.market-entry.count')).toHaveText('4');
});

test('2-插件与Skill-市场页：UI-07 插件市场 18 张卡、三列；UI-08 Skill 市场 12 张', async ({ page }) => {
  await openMarket(page);
  await expect(page.getByTestId('market.grid')).toHaveAttribute('data-cols', '3');
  expect(await cardIds(page)).toHaveLength(18);
  await page.evaluate(() => document.fonts.ready);
  await shot(page, '2-插件与Skill-市场页');
  await page.getByTestId('market.tabs:skills').click();
  await expect(page.getByTestId('market.card:pdf')).toBeVisible();
  expect(await cardIds(page)).toHaveLength(12);
  await shot(page, '2-插件与Skill-市场页-Skill市场');
});

test('2-插件与Skill-市场页：离开市场页（点对话）恢复四栏', async ({ page }) => {
  await openMarket(page);
  await expect(page.getByTestId('right.panel')).toHaveCount(0);
  await page.getByTestId('sidebar.conversation-row:cnv_transformer').click();
  await expect(page.getByTestId('files.panel')).toBeVisible();
  await expect(page.getByTestId('right.panel')).toBeVisible();
});

test('2-市场页-标签切换：改路由 /market/:tab，保留搜索词、清空类别；刷新后停留在当前标签；方向键可切换', async ({
  page,
}) => {
  await openMarket(page);
  await page.getByTestId('market.search').fill('mcp');
  await page.getByTestId('market.category:学术检索').click();
  await expect(page).toHaveURL(/cat=/);
  await page.getByTestId('market.tabs:skills').click();
  await expect(page).toHaveURL(/\/market\/skills\?q=mcp$/);
  await page.getByTestId('market.tabs:installed').click();
  await expect(page).toHaveURL(/\/market\/installed\?q=mcp$/);
  await page.getByTestId('market.search').fill('');
  await page.reload();
  await expect(page.getByTestId('market.tabs:installed')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('market.tabs:installed').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('market.tabs:skills')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('market.tabs:skills')).toBeFocused();
  await shot(page, '2-市场页-标签切换');
});

test('2-市场页-搜索框：输入“arxiv”只剩 ArXiv MCP Server，写入 ?q=；× 清空', async ({ page }) => {
  await openMarket(page);
  await page.getByTestId('market.search').fill('arxiv');
  await expect.poll(() => cardIds(page)).toEqual(['arxiv']);
  await expect(page).toHaveURL(/\?q=arxiv$/);
  await shot(page, '2-市场页-搜索框');
  await page.getByTestId('market.search.clear').click();
  await expect.poll(() => cardIds(page)).toHaveLength(18);
});

test('2-市场页-类别筛选：选“学术检索”只剩该类；再点取消', async ({ page }) => {
  await openMarket(page);
  await page.getByTestId('market.category:学术检索').click();
  await expect.poll(() => cardIds(page)).toEqual(['arxiv', 'paper-search']);
  await shot(page, '2-市场页-类别筛选');
  await page.getByTestId('market.category:学术检索').click();
  await expect.poll(() => cardIds(page)).toHaveLength(18);
});

test('2-市场页-排序：选“按星数”后降序（键盘可操作菜单）', async ({ page }) => {
  await openMarket(page);
  await page.getByTestId('market.sort').click();
  await expect(page.getByTestId('market.sort.menu')).toBeVisible();
  await shot(page, '2-市场页-排序');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('market.sort')).toHaveText(/按星数/);
  const ids = await cardIds(page);
  expect(ids.slice(0, 3)).toEqual(['markitdown', 'fetch', 'context7']);
  await expect(page).toHaveURL(/sort=stars/);
});

test('2-市场页-条目卡片：点卡片主体进入详情；星数悬停提示；安装按钮不冒泡', async ({ page }) => {
  await openMarket(page);
  const card = page.getByTestId('market.card:arxiv');
  await expect(card.getByTestId('market.card.stars')).toHaveAttribute(
    'title',
    '3,292 · 所属仓库星数，查询于 2026-11-21',
  );
  await card.hover();
  await shot(page, '2-市场页-条目卡片');
  await page.getByTestId('market.install-button:tavily').click();
  await expect(page.getByTestId('market.install-dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/market\/plugins$/);
  await page.keyboard.press('Escape');
  await card.getByTestId('market.card.open:arxiv').click();
  await expect(page).toHaveURL(/\/market\/plugin\/arxiv$/);
  await expect(page.getByTestId('market.plugin-detail')).toBeVisible();
});

test('2-条目卡片-安装按钮：Skill 直接导入并启用（安装 docx 后卡片变“已安装”）；已安装点击进详情', async ({ page }) => {
  await openMarket(page, '/market/skills');
  const btn = page.getByTestId('market.install-button:docx');
  await btn.click();
  await expect(btn).toHaveText(/已安装/);
  await shot(page, '2-条目卡片-安装按钮');
  await btn.click();
  await expect(page).toHaveURL(/\/market\/skill\/docx$/);
});

test('2-市场页-导入Skill：导入 anthropics/skills 的 pdf 目录成功；本机路径校验失败显示红字', async ({ page }) => {
  await openMarket(page, '/market/skills');
  await page.getByTestId('market.import-skill').click();
  await page.getByTestId('market.import-skill.input').fill('https://github.com/anthropics/skills/tree/main/skills/pdf');
  await shot(page, '2-市场页-导入Skill');
  await page.getByTestId('market.import-skill.submit').click();
  await expect(page.getByTestId('market.import-skill.dialog')).toHaveCount(0);
  await page.getByTestId('market.import-skill').click();
  await page.getByTestId('market.import-skill.source:local').click();
  await page.getByTestId('market.import-skill.input').fill('~/skills/my-notes');
  await page.getByTestId('market.import-skill.submit').click();
  await expect(page.getByTestId('market.import-skill.error')).toHaveText('SKILL.md 头部缺少 description');
  await shot(page, '2-市场页-导入Skill-校验失败');
});

test('3-安装-安装确认弹窗：成功路径（权限 → 配置 → 自检 → 已安装）', async ({ page }) => {
  await openMarket(page);
  await page.getByTestId('market.install-button:tavily').click();
  await expect(page.getByTestId('market.install-dialog.permissions')).toBeVisible();
  await shot(page, '3-安装-安装确认弹窗');
  await page.getByTestId('market.install-dialog.next').click();
  await page.getByTestId('market.install-dialog.field:TAVILY_API_KEY').fill('tvly-xxxx');
  await shot(page, '3-安装-安装确认弹窗-填配置');
  await page.getByTestId('market.install-dialog.next').click();
  await expect(page.getByTestId('market.install-dialog.checking')).toBeVisible();
  await shot(page, '3-安装-安装确认弹窗-自检中');
  await expect(page.getByTestId('market.install-dialog')).toHaveCount(0);
  await expect(page.getByTestId('market.install-button:tavily')).toHaveText(/已安装/);
});

test('3-安装-安装确认弹窗：自检失败路径（查看日志、重试、关闭）', async ({ page }) => {
  await openMarket(page);
  await mock(page, 'setSelfCheckMs', 200);
  // F6b：自检失败样例改为 markitdown（docling 没有适配清单）；先在详情页卸载，再回列表从卡片安装
  await page.getByTestId('market.card.open:markitdown').click();
  await page.getByTestId('market.uninstall').click();
  await page.getByTestId('market.uninstall.ok').click();
  await page.getByTestId('market.breadcrumbs.tab').click();
  await expect(page.getByTestId('market.install-button:markitdown')).toHaveText('安装');
  await page.getByTestId('market.install-button:markitdown').click();
  await page.getByTestId('market.install-dialog.next').click();
  await expect(page.getByTestId('market.install-dialog.failed')).toBeVisible();
  await page.getByTestId('market.install-dialog.show-log').click();
  await expect(page.getByTestId('market.install-dialog.log')).toContainText('tools/list timed out');
  await shot(page, '3-安装-安装确认弹窗-自检失败');
  await page.getByTestId('market.install-dialog.retry').click();
  await expect(page.getByTestId('market.install-dialog.failed')).toBeVisible();
  await page.getByTestId('market.install-dialog.cancel').click();
  await expect(page.getByTestId('market.install-dialog')).toHaveCount(0);
  await expect(page.getByTestId('market.install-button:markitdown')).toBeFocused();
});

test('3-条目卡片-插件详情页：UI-09 复现；面包屑回列表', async ({ page }) => {
  await openMarket(page, '/market/plugin/arxiv');
  await expect(page.getByTestId('market.plugin-tools')).toBeVisible();
  // 契约 v0.3：启动命令、权限说明、简介来自接口
  await expect(page.getByTestId('market.plugin-config.command')).toHaveText(
    'uvx arxiv-mcp-server@0.8.2 --storage-path ~/.mnemosyne/plugins/arxiv',
  );
  await expect(page.getByTestId('market.plugin-detail.permissions')).toContainText(
    '联网：访问 arXiv 与 Semantic Scholar',
  );
  await page.evaluate(() => document.fonts.ready);
  await shot(page, '3-条目卡片-插件详情页');
  await page.getByTestId('market.breadcrumbs.tab').click();
  await expect(page).toHaveURL(/\/market\/plugins$/);
  await expect(page.getByTestId('market.grid')).toBeVisible();
});

test('3-插件详情-工具列表：折叠计数正确，展开显示全部 19 个', async ({ page }) => {
  await openMarket(page, '/market/plugin/arxiv');
  const more = page.getByTestId('market.plugin-tools.more');
  await expect(more).toContainText('等 11 个');
  await more.click();
  await expect(page.locator('[data-testid^="market.plugin-tools.row:"]')).toHaveCount(19);
  await expect(page.locator('[data-testid^="market.plugin-tools.off:"]')).toHaveCount(2);
  await expect(page.getByTestId('market.plugin-tools.off:semantic_search')).toBeVisible();
  await shot(page, '3-插件详情-工具列表');
});

test('3-插件详情-配置卡：已安装插件修改配置并保存 → 重新自检', async ({ page }) => {
  await openMarket(page, '/market/plugin/tavily');
  await mock(page, 'setSelfCheckMs', 200);
  await page.getByTestId('market.install-button').click();
  await page.getByTestId('market.install-dialog.next').click();
  await page.getByTestId('market.install-dialog.field:TAVILY_API_KEY').fill('k1');
  await page.getByTestId('market.install-dialog.next').click();
  await expect(page.getByTestId('market.install-dialog')).toHaveCount(0);
  await page.getByTestId('market.plugin-config.edit').click();
  await page.getByTestId('market.plugin-config.input:TAVILY_API_KEY').fill('k2');
  await shot(page, '3-插件详情-配置卡');
  await page.getByTestId('market.plugin-config.save').click();
  await expect(page.getByTestId('market.plugin-config.field:TAVILY_API_KEY')).toContainText('已设置');
});

test('3-插件详情-卸载：二次确认后卸载，卡片回到“安装”', async ({ page }) => {
  await openMarket(page, '/market/plugin/markitdown');
  await page.getByTestId('market.uninstall').click();
  await expect(page.getByTestId('market.uninstall.confirm')).toBeVisible();
  await shot(page, '3-插件详情-卸载');
  await page.getByTestId('market.uninstall.ok').click();
  await expect(page.getByTestId('market.uninstall.confirm')).toHaveCount(0);
  await expect(page.getByTestId('market.install-button')).toHaveText('安装');
  await page.getByTestId('market.breadcrumbs.tab').click();
  await expect(page.getByTestId('market.install-button:markitdown')).toHaveText('安装');
});

test('3-条目卡片-Skill详情页：UI-10 复现；启用开关；面包屑回列表', async ({ page }) => {
  await openMarket(page, '/market/skill/pdf');
  await expect(page.getByTestId('market.skill-detail.md')).toBeVisible();
  await shot(page, '3-条目卡片-Skill详情页');
  await page.getByTestId('market.skill-detail.toggle').click();
  await expect(page.getByTestId('market.skill-detail.toggle')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('market.breadcrumbs.tab').click();
  await expect(page).toHaveURL(/\/market\/skills$/);
});

test('2-用户卡片-设置弹窗：模型页保存（Key 只写）、检索页、Esc 关闭', async ({ page }) => {
  await openApp(page, '/');
  await mock(page, 'resetMarketWorld');
  await page.getByTestId('sidebar.user-card').click();
  await expect(page.getByTestId('settings.dialog.model')).toBeVisible();
  await shot(page, '2-用户卡片-设置弹窗');
  await page.getByTestId('settings.dialog.api-key').fill('sk-test');
  await page.getByTestId('settings.dialog.save').click();
  await expect(page.getByTestId('settings.dialog.api-key-set')).toHaveText('已设置');
  await page.getByTestId('settings.dialog.nav:search').click();
  await page.getByTestId('settings.dialog.web-search').click();
  await page.getByTestId('settings.dialog.save').click();
  await expect(page.getByTestId('settings.dialog.save')).toBeDisabled();
  await shot(page, '2-用户卡片-设置弹窗-检索');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings.dialog')).toHaveCount(0);
  await expect(page.getByTestId('sidebar.user-card')).toBeFocused();
});

test('3-设置-记忆管理：编辑、删除二次确认（原始对话仍保留）、历史版本、记忆开关', async ({ page }) => {
  await openApp(page, '/');
  await mock(page, 'resetMarketWorld');
  await page.getByTestId('sidebar.user-card').click();
  await page.getByTestId('settings.dialog.nav:memory').click();
  await expect(page.getByTestId('settings.memory.item:mem_hw3_sigmoid')).toBeVisible();
  await page.getByTestId('settings.memory.show-history').check();
  await expect(page.getByTestId('settings.memory.item:mem_hw3_sigmoid_v1')).toBeVisible();
  await shot(page, '3-设置-记忆管理');
  await page.getByTestId('settings.memory.edit:mem_hw3_sigmoid').click();
  await page.getByTestId('settings.memory.input:mem_hw3_sigmoid').fill('改用 ReLU 后梯度恢复');
  await page.getByTestId('settings.memory.save:mem_hw3_sigmoid').click();
  await expect(page.getByTestId('settings.memory.item:mem_hw3_sigmoid')).toContainText('改用 ReLU 后梯度恢复');
  await page.getByTestId('settings.memory.delete:mem_pref_conclusion').click();
  await expect(page.getByTestId('settings.memory.confirm.text')).toHaveText(
    '删除后助手不再使用这条记忆，原始对话仍保留。',
  );
  await shot(page, '3-设置-记忆管理-删除确认');
  await page.getByTestId('settings.memory.confirm.ok').click();
  await expect(page.getByTestId('settings.memory.item:mem_pref_conclusion')).toHaveCount(0);
  await page.getByTestId('settings.memory.enabled').click();
  await expect(page.getByTestId('settings.memory.enabled')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('settings.memory.source:mem_hw3_sigmoid').click();
  await expect(page.getByTestId('settings.dialog')).toHaveCount(0);
});
