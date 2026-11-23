// F6b 端到端（Playwright，跑在 MSW 上）：1-输入框-插件区入口、2-斜杠-Skill选择列表、2-插件区-会话插件弹层、
// 2-会话插件弹层-插件开关、2-会话插件弹层-去插件市场、2-证据胶囊-插件结果卡片。每份规格「下一级」表一行一条用例，并按规格名截图（1440×900）。
// 跑法：MN_PORT=5176 npx playwright test tests/e2e/f6b-plugins.spec.ts --workers=2
import { expect, test, type Page } from '@playwright/test';
import { mock, openApp, shot } from './f1-helpers';

const CID = 'cnv_transformer';
const composer = (page: Page) => page.getByTestId('composer.box');
const textbox = (page: Page) => composer(page).getByRole('textbox');
const entry = (page: Page) => page.getByTestId('composer.plugin-entry');
const popover = (page: Page) => page.getByTestId('plugins.popover');

async function openConversation(page: Page) {
  await openApp(page, `/c/${CID}`, { fixedClock: true });
  await expect(page.getByTestId('chat.assistant-message:msg_tf_a2')).toBeVisible();
  await expect(page.getByTestId('chat.evidence-chip:msg_tf_a1:E1')).toHaveText('1 · p.4');
  await expect(entry(page)).toHaveText('arXiv · 网页检索 · PDF 解析');
}

/** 复现 UI-11 的插件组合：先在主页改模拟后端，再进对话（进对话时插件列表重新读取） */
async function openUi11Conversation(page: Page) {
  await openApp(page, '/', { fixedClock: true });
  await mock(page, 'seedUi11', CID);
  await page.getByTestId(`sidebar.conversation-row:${CID}`).click();
  await expect(page.getByTestId('chat.assistant-message:msg_tf_a2')).toBeVisible();
  await expect(entry(page)).toHaveText('arXiv · Tavily 检索 · PDF 解析');
}

/** 发一句提到 arXiv 的话：模拟后端回放 sse-turn-plugin.json，返回新回答的 message_id */
async function askArxiv(page: Page): Promise<string> {
  await textbox(page).fill('用 arXiv 查一下这篇论文的摘要，它的主要贡献是什么？');
  await textbox(page).press('Enter');
  const chip = page.locator('[data-testid^="chat.evidence-chip:msg_m"][data-testid$=":E1"]');
  await expect(chip).toHaveText('1 · 插件', { timeout: 15_000 });
  await expect(chip).toHaveAttribute('data-state', 'supported');
  return (await chip.getAttribute('data-testid'))!.split(':')[1];
}

/** 回答保存后展开步骤行，最后一步是“加载 Skill：pdf”（同 f3-chat.spec.ts 的写法） */
async function expectSkillStep(page: Page) {
  await expect(page.locator('[data-testid^="chat.assistant-message:msg_m"]').last()).toHaveAttribute(
    'data-status',
    'saved',
    { timeout: 15_000 },
  );
  await page.locator('[data-testid^="chat.step-trail:msg_m"]').last().click();
  await expect(page.locator('[data-testid^="chat.step-trail.detail:"]').last()).toContainText('加载 Skill：pdf');
}

test.describe('1-输入框-插件区入口', () => {
  test('托条列出本对话已启用插件的简称；点击在输入框上方弹出会话插件弹层，胶囊高亮', async ({ page }) => {
    await openConversation(page);
    await entry(page).click();
    await expect(popover(page)).toBeVisible();
    await expect(entry(page)).toHaveAttribute('aria-expanded', 'true');
    const pb = (await popover(page).boundingBox())!;
    const cb = (await composer(page).boundingBox())!;
    expect(pb.y + pb.height).toBeLessThanOrEqual(cb.y + 1); // 在输入框上方
    await shot(page, '1-输入框-插件区入口');
  });

  test('主页托条“已启用 N 个插件”与新对话胶囊数一致；主页里关掉一个后带到新对话', async ({ page }) => {
    await openApp(page, '/', { fixedClock: true });
    await expect(entry(page)).toHaveText('已启用 3 个插件');
    await entry(page).click();
    await popover(page).getByTestId('plugins.toggle:markitdown').click();
    await expect(entry(page)).toHaveText('已启用 2 个插件');
    await page.keyboard.press('Escape');
    const put = page.waitForRequest(
      (r) => r.method() === 'PUT' && /\/api\/conversations\/[^/]+\/plugins$/.test(r.url()),
    );
    await textbox(page).fill('多头注意力是什么');
    await textbox(page).press('Enter');
    expect((await put).postDataJSON()).toEqual({ enabled_plugin_ids: ['arxiv', 'fetch'] });
    await expect(page).toHaveURL(/\/c\/cnv_new\d+$/);
    await expect(entry(page)).toHaveText('arXiv · 网页检索');
  });
});

test.describe('2-插件区-会话插件弹层', () => {
  test('UI-11：本对话的插件（含本轮调用次数、已配置、不可用置灰）＋ Skill 列表＋去插件市场', async ({ page }) => {
    await openUi11Conversation(page);
    await askArxiv(page);
    await entry(page).click();
    const pop = popover(page);
    await expect(pop.getByTestId('plugins.popover.sub:arxiv')).toHaveText('学术检索 · 本轮调用 1 次');
    await expect(pop.getByTestId('plugins.popover.sub:tavily')).toHaveText('网页检索与抓取 · 需要 API Key（已配置）');
    await expect(pop.getByTestId('plugins.popover.sub:markitdown')).toHaveText('文档解析');
    await expect(pop.getByTestId('plugins.popover.sub:zotero')).toHaveText('文献管理 · 本机 Zotero 未连接');
    for (const id of ['arxiv', 'tavily', 'markitdown'])
      await expect(pop.getByTestId(`plugins.toggle:${id}`)).toHaveAttribute('aria-checked', 'true');
    await expect(pop.getByTestId('plugins.toggle:zotero')).toBeDisabled();
    await expect(pop.getByTestId('plugins.toggle:zotero')).toHaveAttribute('aria-checked', 'false');
    await expect(pop.getByTestId('plugins.popover.skill:pdf')).toBeVisible();
    await expect(pop.getByTestId('plugins.go-market')).toBeVisible();
    await page.mouse.move(0, 0);
    await shot(page, '2-插件区-会话插件弹层');
  });

  test('点外部 / Esc 关闭；键盘：Enter 打开、焦点进弹层、Esc 回到胶囊', async ({ page }) => {
    await openConversation(page);
    await entry(page).click();
    await expect(popover(page)).toBeVisible();
    await page.getByTestId('chat.panel').click({ position: { x: 20, y: 20 } });
    await expect(popover(page)).toHaveCount(0);
    await entry(page).focus();
    await page.keyboard.press('Enter');
    await expect(popover(page)).toBeVisible();
    await expect(popover(page).getByTestId('plugins.toggle:arxiv')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect(entry(page)).toBeFocused();
  });

  test('点 Skill 行：输入框出现 /pdf 小标签，发送带 forced_skill，步骤里出现加载 Skill', async ({ page }) => {
    await openConversation(page);
    await entry(page).click();
    await popover(page).getByTestId('plugins.popover.skill:pdf').click();
    await expect(popover(page)).toHaveCount(0);
    await expect(page.getByTestId('composer.skill-tag')).toHaveText('/pdf');
    await expect(textbox(page)).toBeFocused();
    const req = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/messages'));
    await textbox(page).fill('提取表格');
    await textbox(page).press('Enter');
    expect((await req).postDataJSON().forced_skill).toBe('pdf');
    await expectSkillStep(page);
  });

  test('齿轮：打开市场“已安装”标签', async ({ page }) => {
    await openConversation(page);
    await entry(page).click();
    await popover(page).getByTestId('plugins.popover.settings').click();
    await expect(page).toHaveURL(/\/market\/installed$/);
    await expect(page.getByTestId('market.page')).toBeVisible();
  });
});

test.describe('2-会话插件弹层-插件开关', () => {
  test('关掉 arXiv：PUT 本对话启用列表，胶囊少了 arXiv；下一轮提到 arXiv 也不再调用插件', async ({ page }) => {
    await openConversation(page);
    await entry(page).click();
    const put = page.waitForRequest(
      (r) => r.method() === 'PUT' && r.url().endsWith(`/api/conversations/${CID}/plugins`),
    );
    await popover(page).getByTestId('plugins.toggle:arxiv').click();
    expect((await put).postDataJSON()).toEqual({ enabled_plugin_ids: ['fetch', 'markitdown'] });
    await expect(popover(page).getByTestId('plugins.toggle:arxiv')).toHaveAttribute('aria-checked', 'false');
    await expect(entry(page)).toHaveText('网页检索 · PDF 解析');
    await page.mouse.move(0, 0);
    await shot(page, '2-会话插件弹层-插件开关');
    await page.keyboard.press('Escape');
    // 模拟后端：本对话没启用 arxiv 时，提到 arXiv 也回放普通回合（真正的工具清单过滤由后端测试验收）
    await textbox(page).fill('用 arXiv 查一下这篇论文');
    await textbox(page).press('Enter');
    const chip = page.locator('[data-testid^="chat.evidence-chip:msg_m"][data-testid$=":E1"]');
    await expect(chip).toHaveText('1 · p.4', { timeout: 15_000 });
    // 再打开弹层：开关状态来自本对话保存的设置
    await entry(page).click();
    await expect(popover(page).getByTestId('plugins.toggle:arxiv')).toHaveAttribute('aria-checked', 'false');
  });

  test('保存失败：开关回滚并提示', async ({ page }) => {
    await openConversation(page);
    await mock(page, 'failConvPluginsPut', true);
    await entry(page).click();
    const sw = popover(page).getByTestId('plugins.toggle:fetch');
    await sw.click();
    await expect(page.getByText(/插件设置没有保存/)).toBeVisible();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(entry(page)).toHaveText('arXiv · 网页检索 · PDF 解析');
  });
});

test.describe('2-会话插件弹层-去插件市场', () => {
  test('关闭弹层、打开市场插件标签；浏览器返回回到原对话，输入框草稿仍在', async ({ page }) => {
    await openConversation(page);
    await textbox(page).fill('还没写完的问题');
    await entry(page).click();
    await page.mouse.move(0, 0);
    await shot(page, '2-会话插件弹层-去插件市场');
    await popover(page).getByTestId('plugins.go-market').click();
    await expect(popover(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/market\/plugins$/);
    await expect(page.getByTestId('market.page')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/c/${CID}$`));
    await expect(textbox(page)).toHaveValue('还没写完的问题');
  });
});

test.describe('2-斜杠-Skill选择列表', () => {
  test('行首 / 列出已启用 Skill（与弹层下半部同一数据），↓ Enter 选中成小标签，发送带 forced_skill', async ({
    page,
  }) => {
    await openConversation(page);
    await textbox(page).fill('/');
    const menu = page.getByTestId('composer.slash');
    await expect(menu.getByTestId('composer.slash.item:pdf')).toBeVisible();
    await expect(menu.getByTestId('composer.slash.item:literature-review')).toHaveCount(0);
    // 截图 2-斜杠-Skill选择列表 由 f3-chat.spec.ts 生成（F3 已实现本规格，F6b 只复核数据来源），这里不重复写同名文件
    await textbox(page).press('Enter');
    await expect(page.getByTestId('composer.skill-tag')).toHaveText('/pdf');
    await expect(menu).toHaveCount(0);
    const req = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/messages'));
    await textbox(page).fill('总结第 3 页');
    await textbox(page).press('Enter');
    expect((await req).postDataJSON().forced_skill).toBe('pdf');
    await expectSkillStep(page);
  });

  test('继续输入按前缀过滤；无匹配显示“没有匹配的 Skill · 去 Skill 市场”；Esc / 删除 / 关闭', async ({ page }) => {
    await openConversation(page);
    await textbox(page).fill('/pd');
    await expect(page.getByTestId('composer.slash.item:pdf')).toBeVisible();
    await textbox(page).fill('/zz');
    await expect(page.getByTestId('composer.slash')).toContainText('没有匹配的 Skill · 去 Skill 市场');
    await textbox(page).press('Escape');
    await expect(page.getByTestId('composer.slash')).toHaveCount(0);
    await textbox(page).fill('/');
    await expect(page.getByTestId('composer.slash')).toBeVisible();
    await textbox(page).press('Backspace');
    await expect(page.getByTestId('composer.slash')).toHaveCount(0);
  });
});

test.describe('2-证据胶囊-插件结果卡片', () => {
  test('从“1 · 插件”胶囊进入：右栏只读字段表，字段与 locator.fields 一致，超长折叠可展开', async ({ page }) => {
    await openConversation(page);
    const mid = await askArxiv(page);
    await page.getByTestId(`chat.evidence-chip:${mid}:E1`).click();
    const card = page.getByTestId('right.plugin-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('right.plugin-card.plugin')).toHaveText('ArXiv MCP Server');
    await expect(card.getByTestId('right.plugin-card.tool')).toHaveText('get_abstract');
    const keys = await card
      .locator('[data-testid^="right.plugin-card.field:"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.split(':')[1]));
    expect(keys).toEqual(['paper_id', 'title', 'authors', 'published', 'categories', 'abstract']);
    await expect(card.getByTestId('right.plugin-card.value:paper_id')).toHaveText('1706.03762');
    await expect(card.getByTestId('right.plugin-card.value:title')).toHaveText('Attention Is All You Need');
    const toggle = card.getByTestId('right.plugin-card.toggle:abstract');
    await expect(toggle).toHaveText('展开');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(card.getByTestId('right.plugin-card.value:abstract')).toContainText(
      'English constituency parsing both with large and limited training data.',
    );
    await expect(page.getByTestId('right.evidence-bar.text')).toContainText('插件 · get_abstract');
    await shot(page, '2-证据胶囊-插件结果卡片');
  });

  test('历史消息里的插件胶囊：经 GET /api/evidence/{eid} 取证据后同样打开卡片', async ({ page }) => {
    await openConversation(page);
    const mid = await askArxiv(page);
    // 再发一轮普通问题：上一轮不再是“进行中/刚结束的回答”，它的胶囊只能经接口取证据（F4 的历史消息路径）
    await textbox(page).fill('再讲讲多头注意力');
    await textbox(page).press('Enter');
    await expect(page.locator('[data-testid^="chat.assistant-message:msg_m"]').last()).toHaveAttribute(
      'data-status',
      'saved',
      { timeout: 15_000 },
    );
    await expect(page.locator('[data-testid^="chat.assistant-message:msg_m"]')).toHaveCount(2);
    const ev = page.waitForResponse((r) => r.url().includes('/api/evidence/evd_arxiv_abs'));
    await page.getByTestId(`chat.evidence-chip:${mid}:E1`).click();
    expect((await ev).status()).toBe(200);
    await expect(page.getByTestId('right.plugin-card.value:paper_id')).toHaveText('1706.03762');
  });
});
