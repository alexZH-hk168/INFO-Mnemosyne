// [VER1] 真实插件冒烟（可选，MN_REAL_PLUGINS=1 才跑；配置见 playwright.plugins.real.config.ts）。
// 市场里真实安装 ArXiv 与 Fetch → 对话里各调一次真实工具 → 点证据胶囊打开右栏插件结果卡片 / 网页快照。
// 模型是演示模式的确定性假模型：消息里写“插件id__工具名 {JSON 参数}”，假模型按原样调用该工具。
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHOTS = fileURLToPath(new URL('../screenshots-real/', import.meta.url));

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
}

async function lastAnswerId(page: Page): Promise<string> {
  const body = page.locator('[data-testid^="chat.answer-body:"]').last();
  await expect(body).toBeVisible();
  return (await body.getAttribute('data-testid'))!.slice('chat.answer-body:'.length);
}

async function installFromMarket(page: Page, id: string) {
  await page.getByTestId('sidebar.market-entry').click();
  await expect(page.getByTestId('market.page')).toBeVisible();
  await page.getByTestId(`market.card:${id}`).getByTestId(`market.card.open:${id}`).click();
  await expect(page.getByTestId('market.plugin-detail')).toBeVisible();
  await page.getByTestId('market.install-button').click();
  await expect(page.getByTestId('market.install-dialog')).toBeVisible();
  await page.getByTestId('market.install-dialog.next').click();
  // 首次安装可能要等 uvx 下载依赖
  await expect(page.getByTestId('market.install-dialog')).toHaveCount(0, { timeout: 300_000 });
  await expect(page.getByTestId('market.install-button')).toHaveText(/已安装/);
}

async function ask(page: Page, text: string): Promise<string> {
  const answers = page.locator('[data-testid^="chat.answer-body:"]');
  const before = await answers.count();
  const box = page.getByTestId('composer.box').getByRole('textbox');
  await box.fill(text);
  await page.getByTestId('composer.send').click();
  await expect(page).toHaveURL(/\/c\/cnv_[0-9A-Z]+$/);
  // 等这一轮的回答出现（条数变多），再取最后一条的 id
  await expect(answers).toHaveCount(before + 1, { timeout: 120_000 });
  const mid = await lastAnswerId(page);
  await expect(page.getByTestId(`chat.step-trail:${mid}`)).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(`[data-testid^="chat.evidence-chip:${mid}:"]`).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId(`chat.assistant-message:${mid}`)).toHaveAttribute('data-status', 'saved', {
    timeout: 120_000,
  });
  return mid;
}

test('真实插件：市场安装 ArXiv/Fetch → 调用真实工具 → 右栏打开插件结果卡片与网页快照', async ({ page }) => {
  test.skip(process.env.MN_REAL_PLUGINS !== '1', '真实插件冒烟默认跳过，设 MN_REAL_PLUGINS=1 才跑（要联网）');
  const apiErrors: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico'))
      apiErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  await page.goto('/');
  await expect(page.getByTestId('sidebar.panel')).toBeVisible();
  await page.getByTestId('sidebar.new-project').click();
  await page.getByTestId('sidebar.new-project-dialog.input').fill(`真实插件 ${Date.now() % 100000}`);
  await page.getByTestId('sidebar.new-project-dialog.submit').click();

  await installFromMarket(page, 'arxiv');
  await installFromMarket(page, 'fetch');

  // 1. arXiv get_abstract：无 URL 插件证据 → 右栏插件结果卡片
  await page.getByTestId('sidebar.new-chat').click();
  await expect(page.getByTestId('home.onboard')).toBeVisible();
  const mid1 = await ask(page, 'arxiv__get_abstract {"paper_id": "1706.03762"}');
  const trail1 = page.getByTestId(`chat.step-trail:${mid1}`);
  await trail1.click();
  await expect(page.getByText('ArXiv MCP Server · get_abstract').first()).toBeVisible();
  const chip1 = page.locator(`[data-testid^="chat.evidence-chip:${mid1}:"]`, { hasText: '插件' }).first();
  await shot(page, 'VER1-01-真实ArXiv-回答与插件步骤');
  await chip1.click();
  const card = page.getByTestId('right.plugin-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('right.plugin-card.tool')).toContainText('get_abstract');
  await expect(card).toContainText('Attention Is All You Need');
  // 摘要超过 240 字折叠，展开后是插件返回的完整摘要
  await page.getByTestId('right.plugin-card.toggle:abstract').click();
  await expect(page.getByTestId('right.plugin-card.value:abstract')).toContainText('Transformer');
  await shot(page, 'VER1-02-真实ArXiv-插件结果卡片');

  // 2. Fetch 抓 arXiv 摘要页：web 证据 → 右栏网页快照
  const mid2 = await ask(page, 'fetch__fetch {"url": "https://arxiv.org/abs/1706.03762", "max_length": 3000}');
  await page.locator(`[data-testid^="chat.evidence-chip:${mid2}:"]`, { hasText: '网页' }).first().click();
  const web = page.getByTestId('right.web-preview');
  await expect(web).toBeVisible();
  await expect(web).toBeVisible();
  await expect(page.getByTestId('right.web-preview.url')).toContainText('arxiv.org/abs/1706.03762');
  await expect(page.getByTestId('right.web-preview.text')).toContainText('Attention Is All You Need');
  await shot(page, 'VER1-03-真实Fetch-网页快照');

  expect(apiErrors, apiErrors.join('\n')).toEqual([]);
});
