// F1 端到端 · 与 UI-05 逐元素对位：渲染仓库外的概念图 HTML（只读，不拷代码），与实现的左两栏元素位置比较。
// 概念图 HTML 在 INFO5000项目/02-界面设计稿/（AGENTS.md 第 9 节）；不存在时跳过。
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONCEPT_NOW } from './f1-helpers';

// 主仓库 web/ 往上两级、worktree web/ 往上三级是 INFO5000项目/
const CONCEPT =
  ['../../02-界面设计稿', '../../../02-界面设计稿']
    .map((d) => resolve(process.cwd(), d, '05-四栏全开-分支对话.html'))
    .find((f) => existsSync(f)) ?? '(未找到) 02-界面设计稿/05-四栏全开-分支对话.html';
type Box = [number, number, number, number];

async function boxes(page: Page, sel: Record<string, string>) {
  return page.evaluate((s) => {
    const r = (el: Element): Box => {
      const x = el.getBoundingClientRect();
      return [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)];
    };
    const out: Record<string, Box[]> = {};
    // 实现里对话行、文件行的可见行是按钮外面那层容器
    const rowOf = (e: Element) => {
      const id = e.getAttribute('data-testid') ?? '';
      if (id.startsWith('sidebar.conversation-row:')) return e.parentElement ?? e;
      if (id.startsWith('files.file-row:')) return e.closest('[data-status]') ?? e;
      return e;
    };
    for (const [k, q] of Object.entries(s)) out[k] = [...document.querySelectorAll(q)].map((e) => r(rowOf(e)));
    return out;
  }, sel);
}

test('左两栏与 UI-05 逐元素对位（1680×1050，允许 ±4 px）', async ({ page, browser }) => {
  test.skip(!existsSync(CONCEPT), `找不到概念图 HTML：${CONCEPT}`);
  await page.setViewportSize({ width: 1680, height: 1050 });
  const c = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
  await c.goto(`file://${CONCEPT}`);
  await c.evaluate(() => document.fonts.ready);
  const concept = await boxes(c, {
    proj: '.proj',
    files: '.files',
    brand: '.brand .name',
    nav: '.nav a',
    projRows: '.tree .p',
    chats: '.tree .chat',
    fgroups: '.fgroup',
    rows: '.file',
    drop: '.drop',
    user: '.user',
  });
  await c.close();

  await page.clock.setFixedTime(CONCEPT_NOW);
  await page.goto('/c/cnv_transformer');
  await expect(page.getByTestId('files.web-row:doc_web_pytorch_sdpa')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const ours = await boxes(page, {
    proj: '[data-testid="sidebar.panel"]',
    files: '[data-testid="files.panel"]',
    brand: '[data-testid="sidebar.panel"] .font-serif',
    nav: '[data-testid="sidebar.market-entry"]',
    projRows: '[data-testid^="sidebar.project-row:"]',
    chats: '[data-testid^="sidebar.conversation-row:"], [data-testid^="sidebar.load-more"]',
    fgroups: '[data-testid^="files.group:"] > div:first-child',
    rows: '[data-testid^="files.file-row:"], [data-testid^="files.web-row:"]',
    drop: '[data-testid="files.dropzone"]',
    user: '[data-testid="sidebar.user-card"]',
  });

  const report: string[] = [];
  let worst = 0;
  for (const k of Object.keys(concept)) {
    expect(ours[k].length, `${k} 数量`).toBe(concept[k].length);
    concept[k].forEach((cb, i) => {
      const d = cb.map((v, j) => ours[k][i][j] - v);
      const m = Math.max(...d.map(Math.abs));
      worst = Math.max(worst, m);
      if (m > 4) report.push(`${k}[${i}] 概念 ${cb} 实现 ${ours[k][i]}`);
    });
  }
  test.info().annotations.push({ type: 'UI-05 最大偏差', description: `${worst} px` });
  expect(report, report.join('\n')).toEqual([]);
});
