// F2 并行开发用的 Playwright 配置：与主配置相同，只把 dev server 换到 5172 端口（DEVELOPMENT.md §4 端口错开），
// 避免与 F1（5171）及默认 5170 撞号。用法：npx playwright test -c tests/playwright.f2.config.ts --workers=2
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config';

const PORT = 5172;
const webDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  ...base,
  testDir: './e2e',
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: webDir,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
