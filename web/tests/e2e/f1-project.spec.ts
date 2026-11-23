// F1 端到端 · 项目栏：1-外壳-项目栏、1-项目栏-新建对话按钮、1-项目栏-插件与Skill入口、1-项目栏-新建项目按钮、
// 2-新建项目-新建项目弹窗、1-项目栏-项目行、1-项目行-对话行、1-项目行-加载更多、1-项目栏-用户卡片
import { expect, test } from '@playwright/test';
import { openApp, shot } from './f1-helpers';

test('项目栏：与 UI-05 左栏逐项一致；没有“搜索”“长期记忆”入口', async ({ page }) => {
  await openApp(page, '/c/cnv_transformer', { fixedClock: true });
  const panel = page.getByTestId('sidebar.panel');
  await expect(panel.locator('[data-testid^="sidebar.project-row:"]')).toHaveText([
    /深度学习导论\s*\(5\)/,
    /论文精读 · RAG\s*\(4\)/,
    /Python 数据分析\s*\(7\)/,
    /英语学术写作\s*\(2\)/,
    /默认项目\s*\(3\)/,
  ]);
  await expect(panel.locator('[data-testid^="sidebar.conversation-row:"]')).toHaveText([
    /Transformer 注意力精读/,
    /反向传播 · 作业 3\s*昨天/,
    /第 6 周复习卡片\s*3 天前/,
  ]);
  await expect(page.getByTestId('sidebar.conversation-row.branches:cnv_transformer')).toHaveText('2');
  await expect(panel).not.toContainText('搜索');
  await expect(panel).not.toContainText('长期记忆');
  await shot(page, '1-外壳-项目栏');
  await page.getByTestId('sidebar.conversation-row:cnv_backprop_hw3').hover();
  await shot(page, '1-项目行-对话行');
});

test('新建对话按钮：URL 变为 /，中间区回到主页', async ({ page }) => {
  await openApp(page, '/c/cnv_transformer');
  await page.getByTestId('sidebar.new-chat').hover();
  await shot(page, '1-项目栏-新建对话按钮');
  await page.getByTestId('sidebar.new-chat').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home.onboard')).toBeVisible();
  await expect(page.getByTestId('sidebar.conversation-row:cnv_transformer')).not.toHaveAttribute('aria-current');
});

test('插件与 Skill 入口：数字 4（3 插件 + 1 启用 Skill），点击进入 /market/plugins 并高亮', async ({ page }) => {
  await openApp(page);
  const entry = page.getByTestId('sidebar.market-entry');
  await expect(entry.getByTestId('sidebar.market-entry.count')).toHaveText('4');
  await entry.click();
  await expect(page).toHaveURL(/\/market\/plugins$/);
  await expect(page.getByTestId('market.page')).toBeVisible();
  await expect(entry).toHaveCSS('background-color', 'rgb(233, 231, 226)'); // --sel
  await shot(page, '1-项目栏-插件与Skill入口');
});

test('新建项目：弹窗聚焦输入框，回车创建，新项目在顶部并展开；无材料时文件栏默认收起', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('sidebar.new-project').click();
  const input = page.getByTestId('sidebar.new-project-dialog.input');
  await expect(input).toBeFocused();
  await expect(page.getByTestId('sidebar.new-project-dialog.submit')).toBeDisabled();
  await input.fill('强化学习');
  await page.evaluate(() => document.fonts.ready);
  await shot(page, '2-新建项目-新建项目弹窗');
  await input.press('Enter');
  await expect(page.getByTestId('sidebar.new-project-dialog')).toHaveCount(0);
  const first = page.locator('[data-testid^="sidebar.project-row:"]').first();
  await expect(first).toContainText('强化学习');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(first).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('home.onboard')).toBeVisible();
  // 规格 1-外壳-文件栏：新对话且无材料 → 默认收起；手动展开后只显示拖拽区
  await expect(page.getByTestId('shell.collapsed-rail:1')).toBeVisible();
  await page.getByTestId('shell.collapsed-rail.expand:1').click();
  await expect(page.getByTestId('files.panel.project-name')).toHaveText('强化学习');
  await expect(page.locator('[data-testid^="files.group:"]')).toHaveCount(0);
  await expect(page.getByTestId('files.dropzone')).toBeVisible();
  await shot(page, '1-项目栏-新建项目按钮');
});

test('新建项目失败：输入框下红字，保留输入；点遮罩关闭后焦点回到 +', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (window as unknown as { __mnMock: { setMockScenario: (e: string, s: string) => void } }).__mnMock.setMockScenario(
      'POST /api/projects',
      'error',
    ),
  );
  const plus = page.getByTestId('sidebar.new-project');
  await plus.click();
  const input = page.getByTestId('sidebar.new-project-dialog.input');
  await input.fill('会被拒绝');
  await page.getByTestId('sidebar.new-project-dialog.submit').click();
  await expect(page.getByTestId('sidebar.new-project-dialog.error')).toHaveText('项目名需为 1–60 个字');
  await expect(input).toHaveValue('会被拒绝');
  await page.mouse.click(1300, 120); // 遮罩
  await expect(page.getByTestId('sidebar.new-project-dialog')).toHaveCount(0);
  await expect(plus).toBeFocused();
});

test('项目行：切换项目后文件栏显示该项目材料；再点当前项目收起；展开状态刷新保持', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('files.file-row:doc_attention')).toBeVisible();
  await page.getByTestId('sidebar.project-row:prj_python_da').click();
  // 该项目没有材料、当前在主页：文件栏按规格默认收起，手动展开后看到该项目
  await expect(page.getByTestId('shell.collapsed-rail:1')).toBeVisible();
  await page.getByTestId('shell.collapsed-rail.expand:1').click();
  await expect(page.getByTestId('files.panel.project-name')).toHaveText('Python 数据分析');
  await expect(page.getByTestId('files.file-row:doc_attention')).toHaveCount(0);
  await expect(page.getByTestId('sidebar.project-row:prj_python_da')).toHaveAttribute('aria-expanded', 'true');
  await shot(page, '1-项目栏-项目行');
  await page.getByTestId('sidebar.project-row:prj_python_da').click();
  await expect(page.getByTestId('sidebar.project-row:prj_python_da')).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByTestId('sidebar.project-row:prj_dlintro')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('sidebar.project-row:prj_python_da')).toHaveAttribute('aria-expanded', 'false');
});

test('对话行：点击 URL 为 /c/:cid；点分支数在右栏打开最近一个 open 分支', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('sidebar.conversation-row:cnv_week6_cards').click();
  await expect(page).toHaveURL(/\/c\/cnv_week6_cards$/);
  await expect(page.getByTestId('chat.panel') /* F3：对话栏替换了占位 */).toBeVisible();
  await page.getByTestId('sidebar.conversation-row.branches:cnv_transformer').click();
  // F5：分支标签激活时路由为 /c/:cid/b/:bid（规格 2-划词工具条-开分支追问「验收」；见 PROGRESS 未决 U49）
  await expect(page).toHaveURL(/\/c\/cnv_transformer\/b\/br_onehot$/);
  await expect(page.getByTestId('right.tabs.tab:branch:br_onehot')).toHaveAttribute('data-active', 'true');
});

test('加载更多：首页 3 条，点击再取一页，连续点击不重复请求，没有更多时消失', async ({ page }) => {
  await openApp(page, '/', { fixedClock: true });
  const list = page.getByTestId('sidebar.conversation-list:prj_dlintro');
  await expect(list.locator('[data-testid^="sidebar.conversation-row:"]')).toHaveCount(3);
  const pageRequests: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.endsWith('/conversations') && u.searchParams.get('cursor')) pageRequests.push(u.search);
  });
  const more = page.getByTestId('sidebar.load-more:prj_dlintro');
  await more.dblclick();
  await expect(list.locator('[data-testid^="sidebar.conversation-row:"]')).toHaveCount(5);
  await expect(more).toHaveCount(0);
  expect(pageRequests).toEqual(['?cursor=cur_3&limit=20']);
  await shot(page, '1-项目行-加载更多');
});

test('用户卡片：显示“我 · 本机”，点击打开设置（设置弹窗为 F6）', async ({ page }) => {
  await openApp(page);
  const card = page.getByTestId('sidebar.user-card');
  await expect(card).toContainText('我');
  await expect(card).toContainText('本机');
  await card.hover();
  await shot(page, '1-项目栏-用户卡片');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await card.click(); // 设置弹窗属于 F6，F1 只验证调用 openModal('settings')（单元测试覆盖）且不报错
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});
