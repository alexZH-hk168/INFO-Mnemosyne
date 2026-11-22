// F1 端到端 · 文件栏：1-外壳-文件栏、1-文件栏-上传按钮、1-文件栏-拖拽上传区、1-文件栏-文件分组、
// 1-文件分组-文件行、1-文件行-解析失败重试、1-文件分组-网页来源行
import { expect, test } from '@playwright/test';
import { mock, openApp, shot } from './f1-helpers';

const pdf = (name: string, size = 120_000) => ({ name, mimeType: 'application/pdf', buffer: Buffer.alloc(size, 1) });

test('文件栏：与 UI-05 第二栏一致（分组顺序、数量、元信息）', async ({ page }) => {
  await openApp(page, '/c/cnv_transformer', { fixedClock: true });
  const groups = page.locator('[data-testid^="files.group:"]');
  await expect(groups).toHaveCount(5);
  const labels = await groups.evaluateAll((els) =>
    els.map((e) => e.querySelector('div')!.textContent!.replace(/\s+/g, ' ')),
  );
  expect(labels).toEqual(['论文2', '课件2', '代码2', '笔记1', '网页来源2']);
  await expect(page.getByTestId('files.file-row.meta:doc_attention')).toHaveText('15 页');
  await expect(page.getByTestId('files.file-row.meta:doc_longmemeval')).toHaveText('解析 62%');
  await expect(page.getByTestId('files.file-row.meta:doc_transformer_py')).toHaveText('212 行');
  await expect(page.getByTestId('files.file-row.meta:doc_train_ipynb')).toHaveText('14 格');
  await expect(page.getByTestId('files.web-row:doc_web_illustrated')).toContainText('引用 1');
  await shot(page, '1-外壳-文件栏');
  await shot(page, '1-文件栏-文件分组');
});

test('上传 PDF：2 s 内出现解析进度，模拟 3 s 后变为 ready；进入“论文”组', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('files.upload-button.input').setInputFiles(pdf('Transformer-XL.pdf'));
  const row = page.getByTestId('files.group:paper').getByRole('button', { name: /Transformer-XL\.pdf/ });
  await expect(row).toBeVisible({ timeout: 2000 });
  const meta = page.locator('[data-testid^="files.file-row.meta:doc_up"]');
  await expect(meta).toHaveText(/^解析 \d+%$/, { timeout: 2000 });
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  await shot(page, '1-文件分组-文件行');
  const t0 = Date.now();
  await expect(meta).toHaveText('3 页', { timeout: 8000 });
  test.info().annotations.push({ type: 'ready', description: `从看到进度到 ready 用时约 ${Date.now() - t0} ms` });
  await expect(row).not.toHaveAttribute('aria-disabled');
  // ready 后点击：右栏出现该文件标签，行变为选中样式
  await row.click();
  await expect(page.locator('[data-testid^="right.tabs.tab:pdf:doc_up"]')).toBeVisible();
  await expect(row).toHaveAttribute('aria-current', 'true');
});

test('上传按钮：一次选 3 个文件，三个都出现', async ({ page }) => {
  await openApp(page);
  await page
    .getByTestId('files.upload-button.input')
    .setInputFiles([
      pdf('a-论文.pdf'),
      { name: 'utils.py', mimeType: 'text/x-python', buffer: Buffer.from('a = 1\nb = 2\n') },
      { name: '复习.md', mimeType: 'text/markdown', buffer: Buffer.from('# 复习\n') },
    ]);
  await expect(page.getByTestId('files.group:paper')).toContainText('a-论文.pdf');
  await expect(page.getByTestId('files.group:code')).toContainText('utils.py');
  await expect(page.getByTestId('files.group:notes')).toContainText('复习.md');
  await page.getByTestId('files.upload-button').hover();
  await shot(page, '1-文件栏-上传按钮');
});

test('拖拽上传区：拖入悬停变实线加底色；松手后 PDF 出现在“论文”组', async ({ page }) => {
  await openApp(page);
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File([new Uint8Array(50_000)], '拖进来的论文.pdf', { type: 'application/pdf' }));
    return d;
  });
  const panel = page.getByTestId('files.panel');
  await panel.dispatchEvent('dragenter', { dataTransfer: dt });
  await panel.dispatchEvent('dragover', { dataTransfer: dt });
  const zone = page.getByTestId('files.dropzone');
  await expect(zone).toHaveAttribute('data-active', 'true');
  await expect(zone).toHaveCSS('border-top-style', 'solid');
  await shot(page, '1-文件栏-拖拽上传区');
  await panel.dispatchEvent('drop', { dataTransfer: dt });
  await expect(zone).not.toHaveAttribute('data-active');
  await expect(page.getByTestId('files.group:paper')).toContainText('拖进来的论文.pdf');
});

test('解析失败重试：红点与“重试”，点击后回到解析中，3 s 后 ready', async ({ page }) => {
  await openApp(page);
  await mock(page, 'failDocument', 'doc_longmemeval', 'PDF 已加密，无法提取文字');
  // 列表里有解析中的文件，每 2 s 轮询，会自动读到失败状态
  const retry = page.getByTestId('files.reparse:doc_longmemeval');
  await expect(retry).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId('files.file-row.error-dot:doc_longmemeval')).toBeVisible();
  await expect(page.getByTestId('files.file-row:doc_longmemeval')).toHaveAttribute('title', 'PDF 已加密，无法提取文字');
  await page.getByTestId('files.file-row:doc_longmemeval').hover();
  await shot(page, '1-文件行-解析失败重试');
  await retry.click();
  await expect(page.getByTestId('files.file-row.meta:doc_longmemeval')).toHaveText(/^解析 \d+%$/);
  await expect(retry).toHaveCount(0);
  await expect(page.getByTestId('files.file-row.meta:doc_longmemeval')).toHaveText('31 页', { timeout: 8000 });
});

test('网页来源行：点击在右栏打开快照标签', async ({ page }) => {
  await openApp(page);
  const row = page.getByTestId('files.web-row:doc_web_pytorch_sdpa');
  await row.click();
  await expect(page.getByTestId('right.tabs.tab:web:ws_pytorch_sdpa')).toBeVisible();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await shot(page, '1-文件分组-网页来源行');
});
