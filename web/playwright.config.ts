import { defineConfig } from '@playwright/test';

// 不下载浏览器：用云电脑已装的 Chromium。可用环境变量 MN_CHROMIUM 覆盖路径。
const executablePath = process.env.MN_CHROMIUM ?? '/usr/local/lib/lightread-playwright/bin/chromium';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5170',
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5170',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
