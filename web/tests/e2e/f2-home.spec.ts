// F2 端到端：主页、能力卡片扇形与悬停、卡片介绍弹窗（共享元素过渡、←/→、焦点管理）、试一试、减少动效、长任务。
// 每份规格“下一级”表的每一行一条交互测试，并按 1440×900 截图到 tests/screenshots/<规格名>.png。
import { expect, test, type Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS } from '../../src/home/cards';

const shots = resolve(dirname(fileURLToPath(import.meta.url)), '../screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: `${shots}/${name}.png`, animations: 'disabled' }); // 截图时停掉封面循环动画，显示静态封面（与概念图同帧）

const activeTestId = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;
/** 等 spring 停稳 */
const settle = (page: Page, ms = 900) => page.waitForTimeout(ms);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home.onboard')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settle(page, 400);
});

test('1-新建对话-主页：标题、主页输入框自动聚焦、三张卡；截图', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('今天要学习什么？');
  await expect(page.getByTestId('composer.box').getByRole('textbox')).toBeFocused();
  // 主页本身不发 /api 请求
  const apiCalls: string[] = [];
  page.on('request', (r) => new URL(r.url()).pathname.startsWith('/api/') && apiCalls.push(r.url()));
  await page.reload();
  await expect(page.getByTestId('home.onboard')).toBeVisible();
  await settle(page, 400);
  expect(apiCalls).toEqual([]);
  await page.mouse.move(5, 5);
  await shot(page, '1-新建对话-主页');
});

test('1-新建对话-主页：窗口高度 < 760 时卡片缩到 0.85，且不与输入框重叠', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await settle(page, 300);
  const scale = await page
    .getByTestId('home.card-fan')
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  expect(scale).toBeCloseTo(0.85, 2);
  const composer = await box(page, 'composer.box');
  for (const c of CARDS) {
    const b = await box(page, `home.card:${c.id}`);
    expect(b.y).toBeGreaterThan(composer.y + composer.height);
  }
});

test('1-主页-能力卡片组：左右 ±8°、中间略低；悬停抬起 12 px 并转正，另两张让开 24 px；截图', async ({ page }) => {
  const before = Object.fromEntries(
    await Promise.all(CARDS.map(async (c) => [c.id, await box(page, `home.card:${c.id}`)])),
  );
  const angle = (id: string) =>
    page.getByTestId(`home.card:${id}`).evaluate((el) => {
      const m = new DOMMatrix(getComputedStyle(el).transform);
      return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI);
    });
  expect([await angle('paper'), await angle('code'), await angle('slides')]).toEqual([-8, 0, 8]);
  // 中间一张略低：中卡中心低于两侧卡片中心
  const center = (b: { y: number; height: number }) => b.y + b.height / 2;
  expect(center(before.code)).toBeGreaterThan(center(before.paper) + 10);
  expect(center(before.code)).toBeGreaterThan(center(before.slides) + 10);

  await page.getByTestId('home.card:paper').hover({ position: { x: 60, y: 120 } });
  await settle(page);
  expect(await angle('paper')).toBe(0);
  const lifted = await page
    .getByTestId('home.card:paper')
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).f);
  expect(lifted).toBeCloseTo(-12, 0);
  const codeAfter = await box(page, 'home.card:code');
  const slidesAfter = await box(page, 'home.card:slides');
  expect(codeAfter.x - before.code.x).toBeCloseTo(24, 0);
  expect(slidesAfter.x - before.slides.x).toBeCloseTo(24, 0);

  await page.getByTestId('home.card:code').hover();
  await settle(page);
  const paperAfter = await box(page, 'home.card:paper');
  expect(paperAfter.x - before.paper.x).toBeLessThan(-20);
  await shot(page, '1-主页-能力卡片组');
});

test('1-能力卡片组-单张卡片：Tab 依次聚焦三张卡（焦点可见），封面循环动画在跑；截图', async ({ page }) => {
  await expect(page.getByTestId('composer.box').getByRole('textbox')).toBeFocused();
  const order: (string | null)[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    order.push(await activeTestId(page));
  }
  expect(order).toEqual(['home.card:paper', 'home.card:code', 'home.card:slides']);
  const outline = await page.getByTestId('home.card:slides').evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  expect(await page.getByTestId('home.card:slides').getAttribute('data-hovered')).toBe('true');
  // 封面动画：论文扫光、代码逐行、课件梯度箭头，周期 4–6 s
  const anims = await page.evaluate(() =>
    ['.mn-sweep-win', '.mn-code-bar', '.mn-grad'].map((s) => {
      const cs = getComputedStyle(document.querySelector(s)!);
      return [cs.animationName, cs.animationDuration];
    }),
  );
  expect(anims).toEqual([
    ['mn-sweep-win', '5s'],
    ['mn-code-scan', '5s'],
    ['mn-grad-pulse', '5s'],
  ]);
  await settle(page);
  await shot(page, '1-能力卡片组-单张卡片');
});

test('单张卡片 → 点击三张都能打开对应介绍弹窗（共享元素过渡从卡片原位放大）；三张截图', async ({ page }) => {
  for (const c of CARDS) {
    const card = page.getByTestId(`home.card:${c.id}`);
    await card.hover({ position: { x: 40, y: 40 } });
    await settle(page);
    // 在页面里点击并在两帧后量面板：过渡初期面板的视觉框应接近原卡片（从原位放大）
    const m = await page.evaluate(async (id) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="home.card:${id}"]`)!;
      const r = el.getBoundingClientRect();
      el.click();
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const p = document.querySelector('[data-testid="home.card-modal"]')!.getBoundingClientRect();
      return { cardCx: r.x + r.width / 2, cardW: r.width, panelCx: p.x + p.width / 2, panelW: p.width };
    }, c.id);
    expect(m.panelW).toBeLessThan(m.cardW * 1.6);
    expect(Math.abs(m.panelCx - m.cardCx)).toBeLessThan(60);
    const modal = page.getByTestId('home.card-modal');
    await expect(modal).toHaveAttribute('data-card', c.id);
    await settle(page);
    const done = await modal.boundingBox();
    expect(done!.width).toBeCloseTo(1060, 0);
    await expect(modal.getByRole('heading', { level: 2 })).toHaveText(c.headline.join(''));
    await expect(page.getByTestId(`home.card:${c.id}`)).toHaveCSS('opacity', '0');
    await page.mouse.move(5, 5);
    await shot(page, `2-能力卡片-卡片介绍弹窗-${c.title}`);
    await page.getByTestId('home.card-dismiss').click();
    await expect(modal).toHaveCount(0);
    await settle(page, 400);
  }
});

test('2-能力卡片-卡片介绍弹窗：键盘 Enter 打开，←/→ 循环切换，Esc 关闭，焦点回到原卡片', async ({ page }) => {
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await activeTestId(page)).toBe('home.card:code');
  await page.keyboard.press('Enter');
  const modal = page.getByTestId('home.card-modal');
  await expect(modal).toHaveAttribute('data-card', 'code');
  await expect(modal).toBeFocused();
  const seen: string[] = [];
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft']) {
    await page.keyboard.press(key);
    seen.push((await modal.getAttribute('data-card'))!);
  }
  expect(seen).toEqual(['slides', 'paper', 'code', 'paper']);
  await settle(page, 400);
  await expect(modal.getByRole('heading', { level: 2 })).toHaveText(CARDS[0].headline.join(''));
  // 焦点锁：Tab 只在 × / 试一试 / 知道了 之间循环
  const tabs: (string | null)[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    tabs.push(await activeTestId(page));
  }
  expect(tabs).toEqual(['home.card-modal-close', 'home.card-try', 'home.card-dismiss', 'home.card-modal-close']);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect.poll(() => activeTestId(page)).toBe('home.card:code');
  await expect(page.getByTestId('home.card:code')).toHaveCSS('opacity', '1');
});

test('2-卡片介绍弹窗-知道了按钮：遮罩、右上 ×、知道了都关闭（250 ms 收回），焦点回到原卡片；截图', async ({ page }) => {
  for (const how of ['home.card-modal-scrim', 'home.card-modal-close', 'home.card-dismiss']) {
    await page.getByTestId('home.card:slides').click({ position: { x: 200, y: 60 } });
    const modal = page.getByTestId('home.card-modal');
    await expect(modal).toBeVisible();
    await settle(page);
    if (how === 'home.card-dismiss') {
      await page.getByTestId(how).focus();
      await shot(page, '2-卡片介绍弹窗-知道了按钮');
    }
    if (how === 'home.card-modal-scrim') await page.mouse.click(20, 20);
    else await page.getByTestId(how).click();
    const t0 = Date.now();
    await expect(modal).toHaveCount(0);
    expect(Date.now() - t0).toBeLessThan(1000);
    await expect.poll(() => activeTestId(page)).toBe('home.card:slides');
    await page.mouse.move(5, 5);
    await settle(page, 500);
  }
});

test('2-卡片介绍弹窗-试一试按钮：关闭弹窗、主页输入框出现示例问题（不发送）；截图', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));
  await page.getByTestId('home.card:paper').click({ position: { x: 60, y: 120 } });
  await settle(page);
  await page.getByTestId('home.card-try').click();
  await expect(page.getByTestId('home.card-modal')).toHaveCount(0);
  const ta = page.getByTestId('composer.box').getByRole('textbox');
  await expect(ta).toHaveValue(CARDS[0].sampleQuestion);
  await expect(ta).toBeFocused();
  expect(posts).toEqual([]); // TODO(U8)：示例材料未定，本里程碑不上传
  await page.mouse.move(5, 5);
  await settle(page, 500);
  await shot(page, '2-卡片介绍弹窗-试一试按钮');
});

test('减少动效：悬停无位移、封面静态、弹窗只做透明度、关闭直接消失', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByTestId('home.onboard')).toBeVisible();
  await settle(page, 400);
  const before = await box(page, 'home.card:paper');
  const shadowBefore = await page.getByTestId('home.card:paper').evaluate((el) => getComputedStyle(el).boxShadow);
  await page.getByTestId('home.card:paper').hover({ position: { x: 60, y: 120 } });
  await settle(page, 500);
  const after = await box(page, 'home.card:paper');
  expect(after).toEqual(before);
  const shadowAfter = await page.getByTestId('home.card:paper').evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadowAfter).not.toBe(shadowBefore);
  const names = await page.evaluate(() =>
    ['.mn-sweep-win', '.mn-code-bar', '.mn-grad', '.mn-grad-path'].map(
      (s) => getComputedStyle(document.querySelector(s)!).animationName,
    ),
  );
  expect(names).toEqual(['none', 'none', 'none', 'none']);
  await page.getByTestId('home.card:paper').click({ position: { x: 60, y: 120 } });
  const modal = page.getByTestId('home.card-modal');
  await expect(modal).toBeVisible();
  const tf = await modal.evaluate((el) => getComputedStyle(el).transform);
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(tf);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect.poll(() => activeTestId(page)).toBe('home.card:paper');
});

test('悬停与弹窗动画期间无长任务（> 50 ms；预热一轮后的稳态）', async ({ page }) => {
  // 默认跑在 dev server（未打包、React 开发模式）；设 MN_PERF_BASE 可指向生产构建的 vite preview。
  if (process.env.MN_PERF_BASE) await page.goto(process.env.MN_PERF_BASE);
  await expect(page.getByTestId('home.onboard')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // 预热一轮：首次打开弹窗会加载弹窗里才用到的字重、编译模块；只度量稳态交互
  for (const c of CARDS) {
    await page.getByTestId(`home.card:${c.id}`).click({ position: { x: 60, y: 60 } });
    await settle(page, 500);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('home.card-modal')).toHaveCount(0);
    await settle(page, 300);
  }
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: false });
  });
  for (const c of CARDS) {
    await page.getByTestId(`home.card:${c.id}`).hover({ position: { x: 60, y: 60 } });
    await settle(page, 500);
  }
  for (const c of CARDS) {
    await page.getByTestId(`home.card:${c.id}`).click({ position: { x: 60, y: 60 } });
    await settle(page, 700);
    await page.keyboard.press('ArrowRight');
    await settle(page, 400);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('home.card-modal')).toHaveCount(0);
    await settle(page, 400);
  }
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  test.info().annotations.push({ type: 'longtasks', description: JSON.stringify(long) });
  expect(long).toEqual([]);
});
