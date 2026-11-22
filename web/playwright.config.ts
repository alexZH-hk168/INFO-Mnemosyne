import { defineConfig } from '@playwright/test';

// 不下载浏览器：用云电脑已装的 Chromium。可用环境变量 MN_CHROMIUM 覆盖路径。
const executablePath = process.env.MN_CHROMIUM ?? '/usr/local/lib/lightread-playwright/bin/chromium';
// 多个里程碑并行时各用一个端口（docs/DEVELOPMENT.md：F1 5171、F2 5172 …），用 MN_PORT 指定；默认 5170。
const port = Number(process.env.MN_PORT ?? 5170);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
