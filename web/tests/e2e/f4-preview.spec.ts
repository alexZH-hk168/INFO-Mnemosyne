// F4 端到端：右栏（规格 06-右栏 九份 + 2-证据胶囊-插件结果卡片的入口）。
// 跑法：MN_PORT=5174 npx playwright test tests/e2e/f4-preview.spec.ts --workers=2
// 前置：bash scripts/fetch-samples.sh（示例论文 PDF 不入 git）。截图 1440×900 存 tests/screenshots/<规格名>.png。
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp, shot } from './f1-helpers';

const composer = (page: Page) => page.getByTestId('composer.box');
const textbox = (page: Page) => composer(page).getByRole('textbox');
const right = (page: Page) => page.getByTestId('right.panel');

async function openConversation(page: Page, cid = 'cnv_transformer') {
  await openApp(page, `/c/${cid}`, { fixedClock: true });
  await expect(page.getByTestId('chat.assistant-message:msg_tf_a2')).toBeVisible();
  await expect(page.getByTestId('chat.evidence-chip:msg_tf_a1:E1')).toHaveText('1 · p.4');
}

/** 元素是否完整落在容器可视区内 */
async function inView(el: Locator, container: Locator) {
  const a = await el.boundingBox();
  const b = await container.boundingBox();
  if (!a || !b) return false;
  return a.y >= b.y - 1 && a.y + a.height <= b.y + b.height + 1;
}

/** @ transformer.py 提问，等代码问答回合的三个胶囊出现，返回新回答的 message id */
async function askAboutCode(page: Page): Promise<string> {
  await textbox(page).fill('@transformer');
  await page.getByTestId('composer.mention.item:doc_transformer_py').click();
  await textbox(page).pressSequentially(' 第 7 行在算什么？');
  await textbox(page).press('Enter');
  const chip = page.locator('[data-testid^="chat.evidence-chip:msg_m"][data-testid$=":E1"]');
  await expect(chip).toHaveText('1 · L7', { timeout: 15_000 });
  await expect(chip).toHaveAttribute('data-state', 'supported');
  const tid = (await chip.getAttribute('data-testid'))!;
  return tid.split(':')[1];
}

test.describe('PDF 预览与证据栏（UI-06）', () => {
  test('点“1 · p.4”胶囊：跳到第 4 页、高亮脚注 4 的 bbox、证据栏与外挂标签', async ({ page }) => {
    await openConversation(page);
    await expect(right(page).getByTestId('right.panel.empty')).toBeVisible();
    await page.getByTestId('chat.evidence-chip:msg_tf_a1:E1').click();
    const pdf = page.getByTestId('right.pdf-preview');
    await expect(pdf).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(pdf).toHaveAttribute('data-page', '4');
    await expect(page.getByTestId('right.tabs.tab:pdf:doc_attention')).toHaveAttribute('data-active', 'true');
    // 证据栏
    await expect(page.getByTestId('right.evidence-bar.text')).toHaveText('证据 1 · 第 4 页 · 被主线第 1 条回答引用');
    await expect(page.getByTestId('right.evidence-bar')).toHaveAttribute('data-tone', 'material');
    // 高亮：PyMuPDF 实测 bbox，第 4 页
    const hl = page.getByTestId('right.pdf-preview.page:4').getByTestId('right.pdf-preview.highlight');
    await expect(hl).toHaveAttribute('data-box', '107.8,700.3,504,724');
    await expect(page.getByTestId('right.pdf-preview.page:4')).toHaveAttribute('data-rendered', 'true');
    expect(await inView(hl, page.getByTestId('right.pdf-preview.scroller'))).toBe(true);
    // 高亮框在页面上的相对位置与 bbox / 页面尺寸一致（612×792 pt）
    const pg = (await page.getByTestId('right.pdf-preview.page:4').boundingBox())!;
    const hb = (await hl.boundingBox())!;
    const scale = pg.width / 612;
    expect(Math.abs(hb.x + 2 - (pg.x + 107.8 * scale))).toBeLessThan(2);
    expect(Math.abs(hb.y + 1 - (pg.y + 700.3 * scale))).toBeLessThan(2);
    // “证据 1”标签在高亮框右侧，不压正文
    const tag = page.getByTestId('right.pdf-preview.tag');
    await expect(tag).toHaveText('证据 1');
    const tb = (await tag.boundingBox())!;
    expect(tb.x).toBeGreaterThanOrEqual(hb.x + hb.width - 1);
    // 文本层可选中的原文
    await expect(page.getByTestId('right.pdf-preview.page:4').locator('.mn-pdf-text')).toContainText(
      'To illustrate why the dot products get large',
    );
    await expect(page.getByTestId('chat.evidence-chip:msg_tf_a1:E1')).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '2-证据胶囊-PDF预览');
    await shot(page, '2-预览-证据栏');
    await shot(page, '1-外壳-右栏');
  });

  test('证据栏 ‹ › 在同一回答的证据之间切换，可能换标签', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('chat.evidence-chip:msg_tf_a1:E1').click();
    await expect(page.getByTestId('right.evidence-bar.count')).toHaveText('1 / 2');
    await expect(page.getByTestId('right.evidence-bar.prev')).toBeDisabled();
    await page.getByTestId('right.evidence-bar.next').click();
    await expect(page.getByTestId('right.tabs.tab:pptx:doc_l05_attention')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('right.evidence-bar.text')).toHaveText(
      '证据 2 · 第 18 页幻灯片 · 被主线第 1 条回答引用',
    );
    await expect(page.getByTestId('right.slide-preview')).toHaveAttribute('data-page', '18', { timeout: 20_000 });
    await page.getByTestId('right.evidence-bar.prev').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('right.tabs.tab:pdf:doc_attention')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('right.pdf-preview')).toHaveAttribute('data-page', '4', { timeout: 20_000 });
  });

  test('从文件栏打开的 PDF 不显示证据栏、不高亮', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('files.file-row:doc_attention').click();
    await expect(page.getByTestId('right.pdf-preview')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(page.getByTestId('right.evidence-bar')).toHaveCount(0);
    await expect(page.getByTestId('right.pdf-preview.highlight')).toHaveCount(0);
    await expect(page.getByTestId('right.pdf-preview')).toHaveAttribute('data-page', '1');
  });

  test('工具条：页码回车跳页、缩放 50%–200%、页内查找、下载，均可键盘操作', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('files.file-row:doc_attention').click();
    const pdf = page.getByTestId('right.pdf-preview');
    await expect(pdf).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(page.getByTestId('right.pdf-toolbar.pages')).toHaveText('/ 15 页');
    // 页码
    const input = page.getByTestId('right.pdf-toolbar.page');
    await input.focus();
    await input.fill('7');
    await page.keyboard.press('Enter');
    await expect(pdf).toHaveAttribute('data-page', '7');
    // 缩放
    await expect(page.getByTestId('right.pdf-toolbar.zoom')).toHaveText('100%');
    await page.getByTestId('right.pdf-toolbar.zoom-in').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('right.pdf-toolbar.zoom')).toHaveText('110%');
    for (let i = 0; i < 12; i++) await page.getByTestId('right.pdf-toolbar.zoom-in').click({ force: true });
    await expect(page.getByTestId('right.pdf-toolbar.zoom')).toHaveText('200%');
    await expect(page.getByTestId('right.pdf-toolbar.zoom-in')).toBeDisabled();
    for (let i = 0; i < 20; i++) await page.getByTestId('right.pdf-toolbar.zoom-out').click({ force: true });
    await expect(page.getByTestId('right.pdf-toolbar.zoom')).toHaveText('50%');
    await expect(page.getByTestId('right.pdf-toolbar.zoom-out')).toBeDisabled();
    // 查找
    await page.getByTestId('right.pdf-toolbar.find').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('right.pdf-toolbar.find-input')).toBeFocused();
    await page.keyboard.type('Scaled Dot-Product');
    await expect(page.getByTestId('right.pdf-toolbar.find-count')).toHaveText(/^1 \/ \d+$/, { timeout: 20_000 });
    await expect(page.getByTestId('right.pdf-preview.find-active')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('right.pdf-toolbar.find-count')).toHaveText(/^2 \/ \d+$/);
    await shot(page, '2-PDF预览-工具条');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('right.pdf-toolbar.find-bar')).toHaveCount(0);
    await expect(page.getByTestId('right.pdf-toolbar.find')).toBeFocused();
    // 下载
    const dl = page.waitForEvent('download');
    await page.getByTestId('right.pdf-toolbar.download').focus();
    await page.keyboard.press('Enter');
    expect((await dl).suggestedFilename()).toBe('Attention Is All You Need.pdf');
  });
});

test.describe('PPT 预览', () => {
  test('文件行打开单页模式；缩略图切页；页码跳页', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('files.file-row:doc_l05_attention').click();
    const sp = page.getByTestId('right.slide-preview');
    await expect(sp).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(page.getByTestId('right.pdf-toolbar.pages')).toHaveText('/ 32 页');
    await page.getByTestId('right.slide-preview.thumb:5').click();
    await expect(sp).toHaveAttribute('data-page', '5');
    await expect(page.getByTestId('right.slide-preview.page:5')).toHaveAttribute('data-rendered', 'true');
    await expect(page.getByTestId('right.slide-preview.thumb:5')).toHaveAttribute('aria-current', 'page');
  });

  test('点课件证据（L05 p.18）跳到第 18 页', async ({ page }) => {
    await openConversation(page);
    // 回答 1 的 E2 是 partial 引用，胶囊显示“2 · p.18”
    await page.getByTestId('chat.evidence-chip:msg_tf_a1:E2').click();
    const sp = page.getByTestId('right.slide-preview');
    await expect(sp).toHaveAttribute('data-page', '18', { timeout: 20_000 });
    await expect(page.getByTestId('right.slide-preview.page:18')).toHaveAttribute('data-rendered', 'true');
    await expect(page.getByTestId('right.slide-preview.page:18').locator('.mn-pdf-text')).toContainText('softmax 饱和');
    await shot(page, '2-证据胶囊-PPT预览');
  });
});

test.describe('代码、历史对话、网页快照（@ transformer.py 的回合）', () => {
  test('代码胶囊 L7 滚到第 7 行并高亮整行', async ({ page }) => {
    await openConversation(page);
    const mid = await askAboutCode(page);
    await page.getByTestId(`chat.evidence-chip:${mid}:E1`).click();
    const code = page.getByTestId('right.code-preview');
    await expect(code).toHaveAttribute('data-state', 'ready');
    const line7 = page.getByTestId('right.code-preview.line:7');
    await expect(line7).toHaveAttribute('data-hl', 'true');
    await expect(line7).toContainText('scores = q @ k.transpose(-2, -1) / math.sqrt(d_k)');
    await expect(page.locator('[data-testid^="right.code-preview.line:"][data-hl]')).toHaveCount(1);
    await expect(line7).toBeInViewport();
    // Shiki 着色已到
    await expect(line7.locator('span[style*="color"]').first()).toBeVisible();
    await expect(page.getByTestId('right.evidence-bar.text')).toHaveText('证据 1 · 第 7 行 · 被主线第 3 条回答引用');
    await shot(page, '2-文件行-代码预览');
  });

  test('历史对话胶囊：只读显示原对话并高亮引用区间，可打开该对话', async ({ page }) => {
    await openConversation(page);
    const mid = await askAboutCode(page);
    await page.getByTestId(`chat.evidence-chip:${mid}:E2`).click();
    const mp = page.getByTestId('right.message-preview');
    await expect(mp).toBeVisible();
    await expect(page.getByTestId('right.message-preview.source')).toHaveText(
      /来自对话：反向传播 · 作业 3 · 2026-11-21/,
    );
    await expect(page.getByTestId('right.message-preview.highlight')).toHaveText(
      'sigmoid 输入很大时导数 σ(x)(1−σ(x)) 趋近 0，梯度传不回去',
    );
    await expect(mp.locator('li')).toHaveCount(3);
    await expect(right(page)).not.toContainText('记忆');
    await expect(page.getByTestId('right.evidence-bar')).toHaveAttribute('data-tone', 'message');
    await shot(page, '2-证据胶囊-历史对话预览');
    await page.getByTestId('right.message-preview.open').click();
    await expect(page).toHaveURL(/\/c\/cnv_backprop_hw3$/);
  });

  test('网页胶囊：打开快照，高亮 char_range 且与 quote 一致；顶部 URL、抓取时间、打开原网页', async ({ page }) => {
    await openConversation(page);
    const mid = await askAboutCode(page);
    await page.getByTestId(`chat.evidence-chip:${mid}:E3`).click();
    const wp = page.getByTestId('right.web-preview');
    await expect(wp).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('right.web-preview.highlight')).toHaveText(
      'The third and fourth steps are to divide the scores by 8 (the square root of the dimension of the key vectors used in the paper – 64). This leads to having more stable gradients.',
    );
    await expect(page.getByTestId('right.web-preview.url')).toHaveText(
      'https://jalammar.github.io/illustrated-transformer/',
    );
    await expect(page.getByTestId('right.web-preview.fetched-at')).toContainText('抓取于 2026-11-22');
    await expect(wp.locator('iframe')).toHaveCount(0);
    await expect(page.getByTestId('right.evidence-bar')).toHaveAttribute('data-tone', 'web');
    await shot(page, '2-证据胶囊-网页快照预览');
    const popup = page.waitForEvent('popup');
    await page.getByTestId('right.web-preview.open-original').click();
    expect((await popup).url()).toContain('jalammar.github.io/illustrated-transformer');
  });

  test('Notebook 按单元格分块、输出折叠；Markdown 渲染为文档', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('files.file-row:doc_train_ipynb').click();
    const code = page.getByTestId('right.code-preview');
    await expect(code).toHaveAttribute('data-kind', 'ipynb');
    await expect(page.locator('[data-testid^="right.code-preview.cell:"][data-cell]')).toHaveCount(14);
    await expect(page.getByTestId('right.code-preview.cell:5.outputs')).toHaveText('已折叠 1 个输出');
    await page.getByTestId('files.file-row:doc_attention_notes').click();
    await expect(code).toHaveAttribute('data-kind', 'md');
    await expect(code.locator('h1')).toHaveText('注意力笔记');
    await expect(code.locator('table')).toBeVisible();
    await expect(code.locator('.katex').first()).toBeVisible();
  });
});

test.describe('标签条与外壳', () => {
  test('主页无标签时右栏自动收起（UI-01）；打开标签展开；离开主页回到用户保存的 collapsed（原 U40）', async ({
    page,
  }) => {
    await openApp(page, '/', { fixedClock: true });
    await expect(page.getByTestId('shell.collapsed-rail:3')).toBeVisible();
    await expect(page.getByTestId('right.panel')).toHaveCount(0);
    // 打开标签就展开
    await page.getByTestId('files.file-row:doc_transformer_py').click();
    await expect(page.getByTestId('right.code-preview')).toBeVisible();
    // 关掉最后一个标签：主页又自动收起，且没写 localStorage
    await page.getByTestId('right.tabs.close:code:doc_transformer_py').click();
    await expect(page.getByTestId('shell.collapsed-rail:3')).toBeVisible();
    const saved = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('mn.layout.v1') ?? '{}').state?.collapsed?.[3] ?? false);
    expect(await saved()).toBe(false);
    // 离开主页：右栏回到未收起（用户保存的状态）
    await page.getByTestId('sidebar.conversation-row:cnv_transformer').click();
    await expect(page.getByTestId('right.panel.empty')).toBeVisible();
    // 用户在对话页收起右栏（写入 localStorage），回主页再打开标签也会展开
    await page.getByTestId('shell.collapse-button:3').click();
    expect(await saved()).toBe(true);
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('home.onboard')).toBeVisible();
    await expect(page.getByTestId('shell.collapsed-rail:3')).toBeVisible();
    await page.getByTestId('files.file-row:doc_transformer_py').click();
    await expect(page.getByTestId('right.code-preview')).toBeVisible();
  });
  test('切换、× 关闭激活相邻、中键关闭、更多菜单、收起；无标签显示空态', async ({ page }) => {
    await openConversation(page);
    await expect(page.getByTestId('right.panel.empty')).toHaveText('点回答里的证据，或在文件栏选一个文件预览');
    await page.getByTestId('files.file-row:doc_attention').click();
    await page.getByTestId('files.file-row:doc_transformer_py').click();
    await page.getByTestId('files.web-row:doc_web_illustrated').click();
    const tabs = page.locator('[data-testid^="right.tabs.tab:"]');
    await expect(tabs).toHaveCount(3);
    await expect(page.getByTestId('right.tabs.tab:web:ws_jalammar_illustrated')).toHaveAttribute('data-active', 'true');
    // 点击切换
    await page.getByTestId('right.tabs.activate:pdf:doc_attention').click();
    await expect(page.getByTestId('right.tabs.tab:pdf:doc_attention')).toHaveAttribute('data-active', 'true');
    // 悬停显示 ×
    const close = page.getByTestId('right.tabs.close:code:doc_transformer_py');
    await expect(close).toHaveCSS('opacity', '0');
    await page.getByTestId('right.tabs.tab:code:doc_transformer_py').hover();
    await expect(close).toHaveCSS('opacity', '1');
    await expect(page.getByTestId('right.pdf-preview')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(page.getByTestId('right.pdf-preview.page:1')).toHaveAttribute('data-rendered', 'true');
    await shot(page, '1-右栏-标签条');
    // × 关闭当前激活的：激活右侧相邻
    await page.getByTestId('right.tabs.close:pdf:doc_attention').click();
    await expect(tabs).toHaveCount(2);
    await expect(page.getByTestId('right.tabs.tab:code:doc_transformer_py')).toHaveAttribute('data-active', 'true');
    // 中键关闭
    await page.getByTestId('right.tabs.activate:web:ws_jalammar_illustrated').click({ button: 'middle' });
    await expect(tabs).toHaveCount(1);
    // 更多：列出全部标签，键盘可选
    await page.getByTestId('right.tabs.more').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('right.tabs.menu')).toBeVisible();
    await expect(page.getByTestId('right.tabs.menu-item:code:doc_transformer_py')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('right.tabs.menu')).toHaveCount(0);
    await expect(page.getByTestId('right.tabs.more')).toBeFocused();
    // 收起（index 3）
    await page.getByTestId('shell.collapse-button:3').click();
    await expect(page.getByTestId('shell.collapsed-rail:3')).toBeVisible();
    await expect(page.getByTestId('shell.collapsed-rail.tab-count')).toHaveText('1');
    await page.getByTestId('shell.collapsed-rail.expand:3').click();
    // 关掉最后一个回到空态
    await page.getByTestId('right.tabs.close:code:doc_transformer_py').click();
    await expect(page.getByTestId('right.panel.empty')).toBeVisible();
  });

  test('分支标签显示分支面板（F5 替换了 F4 的占位）', async ({ page }) => {
    await openApp(page, '/c/cnv_transformer/b/br_variance', { fixedClock: true });
    await expect(page.getByTestId('right.tabs.tab:branch:br_variance')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('right.branch-panel')).toHaveAttribute('data-bid', 'br_variance');
  });

  test('右栏全程没有编辑入口', async ({ page }) => {
    await openConversation(page);
    const noEdit = async () => {
      await expect(right(page).locator('textarea, [contenteditable="true"], [contenteditable=""]')).toHaveCount(0);
      // 输入框只有工具条的页码与查找
      const ids = await right(page)
        .locator('input')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      for (const id of ids) expect(['right.pdf-toolbar.page', 'right.pdf-toolbar.find-input']).toContain(id);
      await expect(right(page).getByText(/编辑|批注|保存|运行/)).toHaveCount(0);
    };
    await page.getByTestId('chat.evidence-chip:msg_tf_a1:E1').click();
    await expect(page.getByTestId('right.pdf-preview')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await page.getByTestId('right.pdf-toolbar.find').click();
    await noEdit();
    await page.getByTestId('files.file-row:doc_l05_attention').click();
    await noEdit();
    await page.getByTestId('files.file-row:doc_transformer_py').click();
    await noEdit();
    await page.getByTestId('files.file-row:doc_train_ipynb').click();
    await noEdit();
    await page.getByTestId('files.file-row:doc_attention_notes').click();
    await noEdit();
    await page.getByTestId('files.web-row:doc_web_illustrated').click();
    await noEdit();
  });
});
