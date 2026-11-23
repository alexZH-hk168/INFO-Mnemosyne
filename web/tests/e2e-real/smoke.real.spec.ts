// INT1 真实后端端到端冒烟：前端不走 MSW，所有 /api 请求经 Vite 代理打到真实后端（确定性假模型）。
// 一条用例按顺序走完整条用户路径，每一步截图到 web/tests/screenshots-real/。
import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHOTS = fileURLToPath(new URL('../screenshots-real/', import.meta.url));
const PDF = fileURLToPath(new URL('../../../server/tests/data/1706.03762v7.pdf', import.meta.url));
const QUESTION = '为什么要除以 √dk';

let n = 0;
async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  n += 1;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}${String(n).padStart(2, '0')}-${name}.png` });
}

/** 主线上当前显示的最后一条助手回答 id */
async function lastAnswerId(page: Page): Promise<string> {
  const body = page.locator('[data-testid^="chat.answer-body:"]').last();
  await expect(body).toBeVisible();
  const tid = (await body.getAttribute('data-testid'))!;
  return tid.slice('chat.answer-body:'.length);
}

/** 在回答正文里拖选一段文字（与 F5 e2e 同一做法） */
async function dragSelect(page: Page, mid: string, text: string) {
  const pts = await page.evaluate(
    ([m, t]) => {
      const root = document.querySelector(`[data-testid="chat.answer-body:${m}"]`)!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = (node as Text).data.indexOf(t);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        const a = r.getBoundingClientRect();
        r.setStart(node, i + t.length - 1);
        r.setEnd(node, i + t.length);
        const b = r.getBoundingClientRect();
        return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
      }
      return null;
    },
    [mid, text] as const,
  );
  expect(pts, `正文里找不到“${text}”`).not.toBeNull();
  await page.mouse.move(pts!.x1, pts!.y1);
  await page.mouse.down();
  await page.mouse.move((pts!.x1 + pts!.x2) / 2, (pts!.y1 + pts!.y2) / 2, { steps: 4 });
  await page.mouse.move(pts!.x2, pts!.y2, { steps: 4 });
  await page.mouse.up();
}

test('真实后端：项目 → 上传 → 提问 → 证据 → 重新生成 → 分支 → 合并 → 市场', async ({ page }) => {
  test.skip(!existsSync(PDF), `缺示例论文 ${PDF}，先运行 server/scripts/fetch_test_data.py`);
  const apiErrors: string[] = [];
  page.on('response', (r) => {
    // favicon.ico：前端本来就没有站点图标（MSW 模式下同样 404），与前后端对接无关
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) apiErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) apiErrors.push(`console: ${m.text()} @ ${m.location().url}`);
  });

  // 1. 新建项目
  await page.goto('/');
  await expect(page.getByTestId('sidebar.panel')).toBeVisible();
  const projectName = `冒烟 ${Date.now() % 100000}`;
  await page.getByTestId('sidebar.new-project').click();
  await page.getByTestId('sidebar.new-project-dialog.input').fill(projectName);
  await page.getByTestId('sidebar.new-project-dialog.submit').click();
  const row = page.locator('[data-testid^="sidebar.project-row:"]', { hasText: projectName });
  await expect(row).toHaveAttribute('aria-current', 'true');
  await shot(page, '新建项目');

  // 2. 上传示例 PDF，等解析完成
  if (await page.getByTestId('shell.collapsed-rail:1').isVisible()) {
    await page.getByTestId('shell.collapsed-rail.expand:1').click();
  }
  await page.getByTestId('files.upload-button.input').setInputFiles(PDF);
  const fileRow = page.locator('[data-testid^="files.file-row:doc_"]').first();
  await expect(fileRow).toBeVisible();
  await shot(page, '上传-解析中');
  // 行的父元素带 data-status（FileRow），按钮在解析完成前 aria-disabled
  await expect(fileRow.locator('xpath=..')).toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
  await expect(fileRow).not.toHaveAttribute('aria-disabled', 'true');
  const docId = (await fileRow.getAttribute('data-testid'))!.slice('files.file-row:'.length);
  await expect(page.getByTestId(`files.file-row.meta:${docId}`)).toHaveText('15 页');
  await shot(page, '上传-解析完成');

  // 3. 新建对话并提问
  await page.getByTestId('sidebar.new-chat').click();
  await expect(page.getByTestId('home.onboard')).toBeVisible();
  const box = page.getByTestId('composer.box').getByRole('textbox');
  await box.fill(QUESTION);
  await page.getByTestId('composer.send').click();
  await expect(page).toHaveURL(/\/c\/cnv_[0-9A-Z]+$/);
  const cid = page.url().split('/c/')[1];
  await expect(row).toContainText('(1)');

  // 4. 步骤行 + 带证据胶囊的回答
  const mid = await lastAnswerId(page);
  await expect(page.getByTestId(`chat.step-trail:${mid}`)).toBeVisible();
  const chip = page.getByTestId(`chat.evidence-chip:${mid}:E1`);
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/p\.4/);
  await shot(page, '回答-步骤行与证据胶囊');
  await page.getByTestId(`chat.step-trail:${mid}`).click();
  await expect(page.getByTestId(`chat.step-trail.detail:${mid}`)).toBeVisible();
  await shot(page, '回答-步骤详情');
  await page.getByTestId(`chat.step-trail:${mid}`).click();

  // 5. 点胶囊：右栏打开 PDF 第 4 页并高亮
  await chip.click();
  await expect(page.getByTestId('right.pdf-preview')).toHaveAttribute('data-page', '4', { timeout: 30_000 });
  await expect(
    page.getByTestId('right.pdf-preview.page:4').getByTestId('right.pdf-preview.highlight'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('right.pdf-toolbar.pages')).toHaveText('/ 15 页');
  await expect(page.getByTestId('right.pdf-preview.page:4')).toHaveAttribute('data-rendered', 'true', { timeout: 30_000 });
  await shot(page, '证据胶囊-PDF第4页高亮');

  // 6. 重新生成
  const regenReq = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/messages/${mid}/regenerate`));
  await page.getByTestId(`chat.regenerate:${mid}`).click();
  // U74：重新生成带上原回合参数（不联网、全部材料）
  expect((await regenReq).postDataJSON()).toEqual({ web_search: false, scope: { mode: 'all' } });
  await expect(page.getByTestId(`chat.regenerate.count:${mid}`).or(page.locator('[data-testid^="chat.regenerate.count:"]').last())).toHaveText('2/2', { timeout: 30_000 });
  const mid2 = await lastAnswerId(page);
  expect(mid2).not.toBe(mid);
  await expect(page.getByTestId(`chat.evidence-chip:${mid2}:E1`)).toBeVisible();
  await shot(page, '重新生成-第2版');

  // 7. 划词开分支 → 分支里追问 → 要点合并到主线
  const sel = 'The input consists of queries and keys';
  await dragSelect(page, mid2, sel);
  await expect(page.getByTestId('chat.toolbar-branch')).toBeVisible();
  await shot(page, '划词-工具条');
  await page.getByTestId('chat.toolbar-branch').click();
  const panel = page.getByTestId('right.branch-panel');
  await expect(panel).toBeVisible();
  const bid = (await panel.getAttribute('data-bid'))!;
  expect(bid).toMatch(/^br_/);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/b/${bid}$`));
  await shot(page, '分支-新建');
  const branchBox = panel.getByTestId('composer.box').getByRole('textbox');
  await branchBox.fill('这里的 dk 指什么？');
  await panel.getByTestId('composer.send').click();
  await expect(panel.locator('[data-testid^="chat.answer-body:"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('[data-testid^="chat.evidence-chip:"]').first()).toBeVisible();
  await shot(page, '分支-追问回答');
  await page.getByTestId('right.branch-merge').click();
  await page.getByTestId('right.branch-merge.confirm').click();
  const mergeCard = page.locator('[data-testid^="chat.merge-card:"]');
  await expect(mergeCard).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('right.branch-panel.merged')).toBeVisible();
  // U87：已合并分支输入框只读（后端同时拒收发往该分支的消息，见 server/tests/test_int1.py）
  await expect(panel.getByTestId('composer.box').getByRole('textbox')).toHaveAttribute('readonly', '');
  await shot(page, '分支-要点合并到主线');

  // 8. 市场页与插件详情
  await page.getByTestId('sidebar.market-entry').click();
  await expect(page.getByTestId('market.page')).toBeVisible();
  await expect(page.locator('[data-testid^="market.card:"]').first()).toBeVisible();
  await shot(page, '市场页');
  await page.getByTestId('market.card:arxiv').getByTestId('market.card.open:arxiv').click();
  await expect(page.getByTestId('market.plugin-detail')).toBeVisible();
  await expect(page.getByTestId('market.plugin-detail.permissions')).toBeVisible();
  await shot(page, '插件详情');

  expect(apiErrors, apiErrors.join('\n')).toEqual([]);
});
