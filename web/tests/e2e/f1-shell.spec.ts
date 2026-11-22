// F1 端到端 · 外壳：1-启动-应用外壳、1-外壳-分栏拖拽条、1-外壳-栏收起按钮、1-外壳-收起态竖条、1-外壳-全局快捷键、1-外壳-全局提示
import { expect, test } from '@playwright/test';
import { box, drag, mock, openApp, persistedLayout, shot } from './f1-helpers';

test('1440 宽时左两栏只能再变宽 32 px（右栏先让到 400，对话栏不小于 480）', async ({ page }) => {
  await openApp(page);
  await drag(page, page.getByTestId('shell.resize-handle:0'), 100);
  expect((await box(page.getByTestId('sidebar.panel'))).width).toBe(284);
  expect((await box(page.getByTestId('center.pane'))).width).toBe(480);
});

test('应用外壳：1440×900 左两栏与 UI-05 对齐（±4 px），直接打开分支地址时右栏打开该分支', async ({ page }) => {
  await openApp(page, '/c/cnv_transformer/b/br_variance', { fixedClock: true });
  await expect(page.getByTestId('right.placeholder-tab:branch:br_variance')).toBeVisible();
  await expect(page.getByTestId('sidebar.conversation-row:cnv_transformer')).toHaveAttribute('aria-current', 'page');
  // UI-05 实测：项目栏 x=8、宽 252；文件栏 x=268、宽 236（外层 padding 8、拖拽条 8）
  const p = await box(page.getByTestId('sidebar.panel'));
  const f = await box(page.getByTestId('files.panel'));
  for (const [got, want] of [
    [p.x, 8],
    [p.y, 8],
    [p.width, 252],
    [p.height, 900 - 16],
    [f.x, 268],
    [f.width, 236],
  ] as const)
    expect(Math.abs(got - want)).toBeLessThanOrEqual(4);
  // 对话栏 ≥ 480
  expect((await box(page.getByTestId('center.pane'))).width).toBeGreaterThanOrEqual(479);
  await shot(page, '1-启动-应用外壳');
  // 同一状态 1680×1050（UI-05 的画布尺寸）另存一张，便于并排对照
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.screenshot({ path: 'tests/screenshots/1-启动-应用外壳@1680x1050.png' });
});

test('分栏拖拽条：拖动实时改宽、松手写入 localStorage、刷新保持；拖不出最小/最大；双击恢复默认', async ({ page }) => {
  // 1440 宽时对话栏已在 480 下限、右栏只能再让 32 px，左两栏拉不到上限；按 UI-05 的 1680×1050 测
  await page.setViewportSize({ width: 1680, height: 1050 });
  await openApp(page);
  const h0 = page.getByTestId('shell.resize-handle:0');
  await h0.hover();
  await expect(h0.locator('span')).toHaveCSS('opacity', '1'); // 悬停出现竖线
  await shot(page, '1-外壳-分栏拖拽条');
  await drag(page, h0, 60);
  expect((await box(page.getByTestId('sidebar.panel'))).width).toBe(312);
  expect((await persistedLayout(page)).sizes[0]).toBe(312);
  await drag(page, h0, 400);
  expect((await box(page.getByTestId('sidebar.panel'))).width).toBe(360); // 最大 360
  await drag(page, page.getByTestId('shell.resize-handle:1'), -300);
  expect((await box(page.getByTestId('files.panel'))).width).toBe(200); // 最小 200
  await page.reload();
  await expect(page.getByTestId('sidebar.panel')).toBeVisible();
  expect((await box(page.getByTestId('sidebar.panel'))).width).toBe(360);
  expect((await box(page.getByTestId('files.panel'))).width).toBe(200);
  await page.getByTestId('shell.resize-handle:0').dblclick();
  expect((await box(page.getByTestId('sidebar.panel'))).width).toBe(252);
  // 键盘：获得焦点时 ← / → 每次 16 px
  await page.getByTestId('shell.resize-handle:1').focus();
  await page.keyboard.press('ArrowRight');
  expect((await box(page.getByTestId('files.panel'))).width).toBe(216);
});

test('拖动流畅度：拖动过程中每帧都更新宽度（记录 rAF 间隔）', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await openApp(page);
  const h0 = page.getByTestId('shell.resize-handle:0');
  const b = await box(h0);
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[] };
    w.__frames = [];
    const tick = (t: number) => {
      w.__frames.push(t);
      if (w.__frames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(b.x + 4, b.y + 100);
  await page.mouse.down();
  const widths: number[] = [];
  for (let i = 1; i <= 30; i += 1) {
    await page.mouse.move(b.x + 4 + i * 3, b.y + 100);
    widths.push((await box(page.getByTestId('sidebar.panel'))).width);
  }
  await page.mouse.up();
  // 每一步都跟手（单调不减、没有回跳）
  for (let i = 1; i < widths.length; i += 1) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
  expect(widths.at(-1)).toBe(252 + 90);
  const gaps = await page.evaluate(() => {
    const f = (window as unknown as { __frames: number[] }).__frames;
    return f.slice(1).map((t, i) => t - f[i]);
  });
  const sorted = [...gaps].sort((a, z) => a - z);
  test.info().annotations.push({
    type: 'raf',
    description: `帧间隔中位数 ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms，P95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms（headless，仅供参考）`,
  });
});

test('收起按钮与竖条：三处收起，刷新保持；点竖条展开；四种组合下对话栏吸收剩余空间', async ({ page }) => {
  await openApp(page);
  const btn0 = page.getByTestId('shell.collapse-button:0');
  await btn0.hover();
  await shot(page, '1-外壳-栏收起按钮');
  await btn0.click();
  await page.getByTestId('shell.collapse-button:1').click();
  await page.getByTestId('shell.collapse-button:3').click();
  expect((await persistedLayout(page)).collapsed).toEqual([true, true, false, true]);
  await page.reload();
  for (const i of [0, 1, 3]) {
    const rail = page.getByTestId(`shell.collapsed-rail:${i}`);
    await expect(rail).toBeVisible();
    expect((await box(rail)).width).toBe(44);
  }
  // 1440 − 16（外边距）− 24（三个 8 px 间隔）− 44×3 = 1268
  expect((await box(page.getByTestId('center.pane'))).width).toBe(1268);
  await page.evaluate(() => document.fonts.ready);
  await shot(page, '1-外壳-收起态竖条');
  const combos: [number, number][] = [];
  for (const i of [0, 1, 3]) {
    await page.getByTestId(`shell.collapsed-rail:${i}`).click({ position: { x: 22, y: 300 } }); // 点空白处
    const c = (await box(page.getByTestId('center.pane'))).width;
    combos.push([i, c]);
  }
  // 依次展开项目栏（252）、文件栏（236）、右栏（让位后 432）：对话栏 1268 → 1060 → 868 → 480
  expect(combos.map(([, c]) => c)).toEqual([1268 - 208, 1268 - 208 - 192, 480]);
});

test('全局快捷键：Ctrl 与 Meta 两套都生效；Ctrl+K 新建对话', async ({ page }) => {
  await openApp(page, '/c/cnv_transformer');
  for (const mod of ['Control', 'Meta']) {
    await page.keyboard.press(`${mod}+1`);
    await expect(page.getByTestId('shell.collapsed-rail:0')).toBeVisible();
    await page.keyboard.press(`${mod}+2`);
    await expect(page.getByTestId('shell.collapsed-rail:1')).toBeVisible();
    await page.keyboard.press(`${mod}+Period`);
    await expect(page.getByTestId('shell.collapsed-rail:3')).toBeVisible();
    if (mod === 'Control') await shot(page, '1-外壳-全局快捷键'); // 三栏都被快捷键收起后的状态
    await page.keyboard.press(`${mod}+1`);
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+Period`);
    await expect(page.getByTestId('sidebar.panel')).toBeVisible();
    await expect(page.getByTestId('files.panel')).toBeVisible();
  }
  await expect(page.getByTestId('center.conversation-placeholder')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('center.home-placeholder')).toBeVisible();
  // Esc 关闭弹窗
  await page.getByTestId('sidebar.new-project').click();
  await expect(page.getByTestId('sidebar.new-project-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sidebar.new-project-dialog')).toHaveCount(0);
});

test('全局提示：错误提示不自动消失、可键盘关闭；info 4 s 后消失', async ({ page }) => {
  await openApp(page);
  // 上传不支持的类型 → 前端拦截并给错误提示
  await page.getByTestId('files.upload-button.input').setInputFiles({
    name: '作业3.docx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('x'),
  });
  const toast = page.locator('[data-testid^="shell.toast:toast_"]');
  await expect(toast).toHaveAttribute('role', 'alert');
  await expect(toast).toContainText('作业3.docx');
  await shot(page, '1-外壳-全局提示');
  await page.waitForTimeout(4500);
  await expect(toast).toBeVisible();
  await page.locator('[data-testid^="shell.toast.dismiss:"]').focus();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0);
});

test('窄窗口：< 1100 文件栏自动收起，< 900 项目栏也收起；不写 localStorage', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openApp(page);
  await expect(page.getByTestId('shell.collapsed-rail:1')).toBeVisible();
  await expect(page.getByTestId('sidebar.panel')).toBeVisible();
  await page.setViewportSize({ width: 860, height: 800 });
  await expect(page.getByTestId('shell.collapsed-rail:0')).toBeVisible();
  expect((await persistedLayout(page))?.collapsed ?? [false, false, false, false]).toEqual([
    false,
    false,
    false,
    false,
  ]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId('files.panel')).toBeVisible();
  await expect(page.getByTestId('sidebar.panel')).toBeVisible();
});

test('键盘可达与焦点可见：Tab 能到达收起按钮且有 2 px 焦点环', async ({ page }) => {
  await openApp(page);
  await mock(page, 'resetMockScenarios');
  const target = page.getByTestId('shell.collapse-button:0');
  let reached = false;
  for (let i = 0; i < 6 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await target.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await expect(target).toHaveCSS('outline-width', '2px');
  await expect(target).toHaveCSS('outline-style', 'solid');
});
