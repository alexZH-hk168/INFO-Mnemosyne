// F1 端到端测试的公共工具。
import { expect, type Locator, type Page } from '@playwright/test';

/** 概念图里的“今天”：让“昨天 / 3 天前”与 UI-05 一致（只用于截图类测试；不影响 performance.now） */
export const CONCEPT_NOW = new Date('2026-11-22T16:00:00+08:00');

export async function openApp(page: Page, path = '/', opts: { fixedClock?: boolean } = {}) {
  if (opts.fixedClock) await page.clock.setFixedTime(CONCEPT_NOW);
  await page.goto(path);
  await expect(page.getByTestId('shell.app')).toBeVisible();
  await page.waitForFunction(() => 'resetWorld' in ((window as unknown as { __mnMock?: object }).__mnMock ?? {}));
  await expect(page.getByTestId('sidebar.project-row:prj_dlintro')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

export const shot = (page: Page, spec: string) =>
  page.screenshot({ path: `tests/screenshots/${spec}.png`, fullPage: false });

export async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('元素不可见');
  return b;
}

/** 调 window.__mnMock 上的开关 */
export async function mock(page: Page, fn: string, ...args: unknown[]) {
  return page.evaluate(
    ([f, a]) => {
      const m = (window as unknown as { __mnMock: Record<string, (...x: unknown[]) => unknown> }).__mnMock;
      return m[f as string](...(a as unknown[]));
    },
    [fn, args] as const,
  );
}

/** 读 localStorage 里持久化的 useLayout 状态 */
export async function persistedLayout(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mn.layout.v1') ?? '{}').state as {
        sizes: number[];
        collapsed: boolean[];
      },
  );
}

/** 用鼠标拖动拖拽条 dx 像素 */
export async function drag(page: Page, handle: Locator, dx: number) {
  const b = await box(handle);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(x + (dx * i) / steps, y);
  await page.mouse.up();
}
