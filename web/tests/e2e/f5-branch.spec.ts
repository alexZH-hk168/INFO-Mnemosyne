// F5 端到端：划词工具条、分支面板、分支标记、分支概览标签、合并卡片（11 份规格，每个“下一级”一条交互）。
// 跑法：MN_PORT=5175 npx playwright test tests/e2e/f5-branch.spec.ts --workers=2
// 截图 1440×900 存 tests/screenshots/<规格名>.png。
import { expect, test, type Page } from '@playwright/test';
import { openApp, shot } from './f1-helpers';

const CID = 'cnv_transformer';
const list = (page: Page) => page.getByTestId('chat.message-list');
const panel = (page: Page) => page.getByTestId('right.branch-panel');
const toolbar = (page: Page) => page.getByTestId('chat.selection-toolbar');
const mainComposer = (page: Page) => page.locator('[data-testid="composer.box"][data-variant="chat"]');
const branchComposer = (page: Page) => page.locator('[data-testid="composer.box"][data-variant="branch"]');

async function openConversation(page: Page, path = `/c/${CID}`) {
  await openApp(page, path, { fixedClock: true });
  await expect(page.getByTestId('chat.assistant-message:msg_tf_a2')).toBeVisible();
  await expect(page.getByTestId('chat.evidence-chip:msg_tf_a1:E1')).toHaveText('1 · p.4');
}

/** 用鼠标在某条回答正文里拖选第 n 次出现的 text（只在一个文本节点内） */
async function dragSelect(page: Page, mid: string, text: string) {
  const pts = await page.evaluate(
    ([m, t]) => {
      const root = document.querySelector(`[data-testid="chat.answer-body:${m}"]`)!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n as Text).data.indexOf(t);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const a = r.getBoundingClientRect();
        r.setStart(n, i + t.length - 1);
        r.setEnd(n, i + t.length);
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

/** 浏览器里当前的 useUI.selection（经 data-* 暴露在工具条上） */
/** 在对话栏空白处点一下（取消浏览器选区） */
async function clickBlank(page: Page) {
  const b = (await list(page).boundingBox())!;
  await page.mouse.click(b.x + 12, b.y + b.height - 12);
}

test.describe('F5 分支对话', () => {
  test('UI-05 复现：在“方差是 dₖ”处开分支 → 右栏出现分支并聚焦输入框，主线原句虚线下划线与“⑂”标记', async ({
    page,
  }) => {
    await openConversation(page);
    await dragSelect(page, 'msg_tf_a1', '方差是 dₖ');
    await expect(toolbar(page)).toBeVisible();
    await shot(page, '2-划词-划词工具条');
    // 工具条在选区上方
    const tb = (await toolbar(page).boundingBox())!;
    const sel = await page.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().top);
    expect(tb.y + tb.height).toBeLessThanOrEqual(sel + 1);
    const req = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/branches'));
    await page.getByTestId('chat.toolbar-branch').click();
    const body = (await req).postDataJSON();
    expect(body.anchor.quote).toBe('方差是 dₖ');
    expect(body.anchor.end - body.anchor.start).toBe(6);
    // 右栏出现分支、输入框聚焦、路由
    await expect(panel(page)).toBeVisible();
    const bid = await panel(page).getAttribute('data-bid');
    expect(bid).toMatch(/^br_new\d+$/);
    await expect(page).toHaveURL(new RegExp(`/c/${CID}/b/${bid}$`));
    await expect(branchComposer(page).getByRole('textbox')).toBeFocused();
    await expect(branchComposer(page).getByRole('textbox')).toHaveAttribute('placeholder', '就这句话追问…');
    await expect(page.getByTestId(`right.tabs.tab:branch:${bid}`)).toHaveAttribute('data-active', 'true');
    // 主线原句：虚线下划线；与已有分支“方差为什么是 dₖ”同一句，小标显示 ⑂ 2
    const mark = page.locator(`[data-mn-branch-ids~="${bid}"]`).first();
    await expect(mark).toHaveCSS('text-decoration-style', 'dashed');
    const badge = page.getByTestId('chat.branch-mark:br_variance');
    await expect(badge).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('chat.branch-chip')).toHaveText('主线 · 3 个分支');
    await shot(page, '2-划词工具条-开分支追问');
  });

  test('UI-05 截图对照：打开“方差为什么是 dₖ”分支，在主线选中一句', async ({ page }) => {
    await openConversation(page, `/c/${CID}/b/br_variance`);
    await expect(panel(page)).toHaveAttribute('data-bid', 'br_variance');
    await expect(page.getByTestId('chat.evidence-chip:msg_bv_a1:E1')).toHaveText('1 · p.4');
    await dragSelect(page, 'msg_tf_a1', 'softmax 饱和时梯度同样几乎为 0');
    await expect(toolbar(page)).toBeVisible();
    await shot(page, '2-开分支追问-分支面板');
    await shot(page, '1-助手回答-分支标记');
  });

  test('工具条：< 2 字、跨消息不出现；点别处 / Esc / 滚动关闭；键盘可达', async ({ page }) => {
    await openConversation(page);
    await dragSelect(page, 'msg_tf_a1', '方差');
    await expect(toolbar(page)).toBeVisible();
    // 点别处关闭
    await clickBlank(page);
    await expect(toolbar(page)).toHaveCount(0);
    // Esc
    await dragSelect(page, 'msg_tf_a1', '方差是 dₖ');
    await expect(toolbar(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toolbar(page)).toHaveCount(0);
    // 滚动
    await dragSelect(page, 'msg_tf_a1', '方差是 dₖ');
    await expect(toolbar(page)).toBeVisible();
    await list(page).evaluate((el) => el.scrollBy(0, -40));
    await expect(toolbar(page)).toHaveCount(0);
    // 键盘：Tab 进入，→ 移动（先点别处取消上一次的浏览器选区，否则按在已选文字上会变成拖动）
    await clickBlank(page);
    await dragSelect(page, 'msg_tf_a1', '方差是 dₖ');
    await expect(toolbar(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('chat.toolbar-branch')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('chat.toolbar-quote')).toBeFocused();
    await page.keyboard.press('Escape');
    // 1 个字：不出现
    await dragSelect(page, 'msg_tf_a1', '方');
    await expect(toolbar(page)).toHaveCount(0);
    // 跨两条回答：不出现
    const a = (await page.getByTestId('chat.answer-body:msg_tf_a1').boundingBox())!;
    const b = (await page.getByTestId('chat.answer-body:msg_tf_a2').boundingBox())!;
    await page.mouse.move(a.x + 30, a.y + a.height - 8);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + 8, { steps: 6 });
    await page.mouse.up();
    await expect(toolbar(page)).toHaveCount(0);
  });

  test('引用：主线输入框插入 > quote 并聚焦，不发请求', async ({ page }) => {
    await openConversation(page);
    await dragSelect(page, 'msg_tf_a1', 'softmax 饱和时梯度同样几乎为 0');
    let posted = false;
    page.on('request', (r) => {
      if (r.method() !== 'GET') posted = true;
    });
    await page.getByTestId('chat.toolbar-quote').click();
    const ta = mainComposer(page).getByRole('textbox');
    await expect(ta).toHaveValue('> softmax 饱和时梯度同样几乎为 0\n\n');
    await expect(ta).toBeFocused();
    expect(posted).toBe(false);
    await expect(page.getByTestId('right.panel')).toHaveAttribute('data-kind', 'empty');
    await shot(page, '2-划词工具条-引用');
  });

  test('复制：剪贴板不含胶囊文字，提示“已复制”', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openConversation(page);
    // 从“方差是 dₖ”拖到下一句“dₖ = 64”：中间夹着“⑂ 分支”小标与“1 · p.4”胶囊
    const pts = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="chat.answer-body:msg_tf_a1"]')!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let start: DOMRect | null = null;
      let end: DOMRect | null = null;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n as Text;
        const i = t.data.indexOf('方差是');
        if (i >= 0 && !start) {
          const r = document.createRange();
          r.setStart(t, i);
          r.setEnd(t, i + 1);
          start = r.getBoundingClientRect();
        }
        const j = t.data.indexOf(' = 64');
        if (j >= 0 && start && !end) {
          const r = document.createRange();
          r.setStart(t, j + 4);
          r.setEnd(t, j + 5);
          end = r.getBoundingClientRect();
        }
      }
      return start && end ? { x1: start.left + 1, y1: start.top + 8, x2: end.right - 1, y2: end.top + 8 } : null;
    });
    await page.mouse.move(pts!.x1, pts!.y1);
    await page.mouse.down();
    await page.mouse.move(pts!.x2, pts!.y2, { steps: 8 });
    await page.mouse.up();
    await expect(toolbar(page)).toBeVisible();
    const domText = await page.evaluate(() => window.getSelection()!.toString());
    expect(domText).toMatch(/p\.4/); // 选区里确实夹着胶囊
    await page.getByTestId('chat.toolbar-copy').click();
    await expect(page.getByText('已复制')).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('方差是 dₖ。dₖ = 64');
    expect(clip).not.toMatch(/p\.4|分支/);
    await shot(page, '2-划词工具条-复制');
  });

  test('分支标记：点击右栏打开该分支；同一句多个分支弹出选择', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('chat.branch-mark:br_onehot').click();
    await expect(panel(page)).toHaveAttribute('data-bid', 'br_onehot');
    await expect(page).toHaveURL(new RegExp(`/c/${CID}/b/br_onehot$`));
    // 在同一句再开一个分支 → ⑂ 2
    await dragSelect(page, 'msg_tf_a1', '方差是 dₖ');
    await page.getByTestId('chat.toolbar-branch').click();
    await expect(page.getByTestId('chat.branch-mark:br_variance')).toHaveAttribute('data-count', '2');
    await page.getByTestId('chat.branch-mark:br_variance').click();
    await expect(page.getByTestId('chat.branch-mark.menu:br_variance')).toBeVisible();
    await expect(page.getByTestId('chat.branch-mark.option:br_variance')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveAttribute('data-bid', 'br_variance');
  });

  test('分支概览标签：弹出分支列表，点分支右栏打开并滚到锚点', async ({ page }) => {
    await openConversation(page);
    await expect(page.getByTestId('chat.branch-chip')).toHaveText('主线 · 2 个分支');
    await page.getByTestId('chat.branch-chip').click();
    await expect(page.getByTestId('chat.branch-chip.menu')).toBeVisible();
    await expect(page.getByTestId('chat.branch-chip.item:br_variance')).toContainText('方差为什么是 dₖ');
    await expect(page.getByTestId('chat.branch-chip.item:br_onehot')).toContainText('“输出接近 one-hot”');
    await shot(page, '1-对话栏-分支概览标签');
    await list(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.getByTestId('chat.branch-chip.item:br_onehot').click();
    await expect(panel(page)).toHaveAttribute('data-bid', 'br_onehot');
    const mark = page.locator('[data-mn-branch-ids~="br_onehot"]').first();
    await expect(mark).toHaveAttribute('data-flash', 'true');
    await expect(mark).toBeInViewport();
  });

  test('回到原处：主线滚到原句并闪烁高亮；fork 消息不在当前主线时先切回再滚', async ({ page }) => {
    await openConversation(page, `/c/${CID}/b/br_variance`);
    await expect(panel(page)).toBeVisible();
    await list(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.getByTestId('right.branch-anchor.back').click();
    const mark = page.locator('[data-mn-branch-ids~="br_variance"]').first();
    await expect(mark).toHaveAttribute('data-flash', 'true');
    await expect(mark).toBeInViewport();
    await shot(page, '2-分支面板-来源原句与回到原处');
    await expect(mark).not.toHaveAttribute('data-flash', 'true', { timeout: 3000 });
    // 重新生成第 1 条回答 → 主线换成兄弟回答，原句不在主线上
    await page.getByTestId('chat.regenerate:msg_tf_a1').click();
    await expect(page.locator('[data-testid^="chat.regenerate.count:"]').first()).toHaveText('2/2', { timeout: 10000 });
    await expect(page.getByTestId('chat.answer-body:msg_tf_a1')).toHaveCount(0);
    const put = page.waitForRequest(
      (r) => r.method() === 'PUT' && r.url().endsWith(`/api/conversations/${CID}/active_leaf`),
    );
    await page.getByTestId('right.branch-anchor.back').click();
    expect((await put).postDataJSON()).toEqual({ message_id: 'msg_tf_a1' });
    await expect(page.getByTestId('chat.answer-body:msg_tf_a1')).toBeVisible();
    await expect(page.locator('[data-mn-branch-ids~="br_variance"]').first()).toHaveAttribute('data-flash', 'true');
  });

  test('分支面板：上下文提示、分支内发送带 branch_id、证据带 leaf_id 并新开预览标签、切走恢复主线', async ({
    page,
  }) => {
    await openConversation(page, `/c/${CID}/b/br_variance`);
    await expect(panel(page)).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('right.branch-context')).toContainText('上下文：主线前 1 轮 + 本分支');
    await page.getByTestId('right.branch-context').hover();
    await expect(page.getByTestId('right.branch-context.tip')).toBeVisible();
    await expect(page.getByTestId('right.branch-context.tip')).toHaveText('分支看不到锚点之后的主线和其他分支。');
    await shot(page, '2-分支面板-上下文提示');
    await page.mouse.move(10, 10);
    // 证据：带 leaf_id
    const evReq = page.waitForRequest((r) => r.url().includes('/api/evidence/evd_att_p4_fn4?leaf_id=msg_bv_a2'));
    await page.getByTestId('chat.evidence-chip:msg_bv_a1:E1').click();
    await evReq;
    await expect(page.getByTestId('right.tabs.tab:pdf:doc_attention')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('right.tabs.tab:branch:br_variance')).toBeVisible();
    // 切走：路由回主线
    await expect(page).toHaveURL(new RegExp(`/c/${CID}$`));
    await page.getByTestId('right.tabs.activate:branch:br_variance').click();
    await expect(page).toHaveURL(new RegExp(`/c/${CID}/b/br_variance$`));
    // 分支内发送
    const send = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`/api/conversations/${CID}/messages`),
    );
    await branchComposer(page).getByRole('textbox').fill('换成方差为 2 会怎样？');
    await branchComposer(page).getByRole('textbox').press('Enter');
    expect((await send).postDataJSON()).toMatchObject({ branch_id: 'br_variance', parent_id: 'msg_bv_a2' });
    await expect(panel(page).getByText('换成方差为 2 会怎样？')).toBeVisible();
    await expect(panel(page).locator('[data-testid^="chat.assistant-message:msg_m"]')).toHaveAttribute(
      'data-status',
      'saved',
      { timeout: 10000 },
    );
    // 主线不出现分支里的问答
    await expect(list(page).getByText('换成方差为 2 会怎样？')).toHaveCount(0);
  });

  test('要点合并：确认后主线末尾出现合并卡片，分支只读；卡片展开与“打开分支”', async ({ page }) => {
    await openConversation(page, `/c/${CID}/b/br_variance`);
    await page.getByTestId('right.branch-merge').click();
    await expect(page.getByTestId('right.branch-merge.dialog')).toContainText(
      '合并后，这个分支里的要点和记忆对主线可见，分支变为只读。',
    );
    await expect(page.getByTestId('right.branch-merge.confirm')).toBeFocused();
    await shot(page, '2-分支面板-要点合并按钮');
    await page.getByTestId('right.branch-merge.confirm').click();
    await expect(page.getByTestId('right.branch-merge')).toHaveAttribute('data-state', 'merging');
    const card = page.getByTestId('chat.merge-card:msg_tf_merge1');
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toBeInViewport();
    await expect(card).toContainText('来自分支：方差为什么是 dₖ');
    await expect(panel(page)).toHaveAttribute('data-state', 'merged');
    await expect(page.getByTestId('right.branch-panel.merged')).toHaveText('已合并到主线');
    await expect(branchComposer(page).getByRole('textbox')).not.toBeEditable();
    await expect(page.getByTestId('right.branch-merge')).toHaveCount(0);
    await expect(page.locator('[data-mn-branch-ids~="br_variance"]').first()).toHaveCSS(
      'text-decoration-style',
      'solid',
    );
    // 展开
    await card.getByTestId('chat.merge-card.toggle:msg_tf_merge1').click();
    await expect(card.getByTestId('chat.merge-card.item:msg_bv_a2')).toBeVisible();
    await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, '1-消息列表-合并卡片');
    // 打开分支
    await page.getByTestId('chat.evidence-chip:msg_tf_a2:E1').click();
    await expect(page.getByTestId('right.tabs.tab:branch:br_variance')).not.toHaveAttribute('data-active', 'true');
    await card.getByTestId('chat.merge-card.open:msg_tf_merge1').click();
    await expect(page.getByTestId('right.tabs.tab:branch:br_variance')).toHaveAttribute('data-active', 'true');
  });
});
