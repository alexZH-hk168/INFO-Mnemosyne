import { defineConfig } from '@playwright/test';

// F6 端到端测试：dev 端口 5176（docs/DEVELOPMENT.md 按里程碑错开端口），只跑 f6-*.spec.ts。
// 用法：npx playwright test -c tests/playwright.f6.config.ts --workers=2
const executablePath = process.env.MN_CHROMIUM ?? '/usr/local/lib/lightread-playwright/bin/chromium';
const port = 5176;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /f6-.*\.spec\.ts$/,
  fullyParallel: true,
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
    cwd: '..',
  },
});
