import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * 真实后端端到端冒烟（INT1）：前端关闭 MSW，经 Vite 代理连真实 FastAPI 后端（假模型，不发付费调用）。
 * BYOK：后端用默认 auto 模式、全新数据目录里没有设置 → 未配置模型＝演示模式（确定性假模型，不联网），
 * 冒烟先核对界面上的“演示模式”提示；不设 MN_LLM_BACKEND，并清掉可能从外部带进来的模型环境变量。
 * 不进默认 e2e（默认 config 的 testDir 是 tests/e2e）。
 *
 * 用法（在 web/ 下）：
 *   MN_PORT=5177 MN_API_PORT=8104 npx playwright test -c tests/e2e-real/playwright.real.config.ts
 * 前置：server/.venv 已就绪；示例论文已下载（server/scripts/fetch_test_data.py → server/tests/data/1706.03762v7.pdf）。
 * 两个服务都由本配置拉起（已在跑就复用）。后端每次用全新的临时数据目录 /tmp/mn-real-<端口>。
 * MN_VITE_CONFIG：可选，Vite 配置文件（worktree 里 node_modules 是软链时用本地 *.local 配置放开 fs.allow）。
 */
const executablePath = process.env.MN_CHROMIUM ?? '/usr/local/lib/lightread-playwright/bin/chromium';
const port = Number(process.env.MN_PORT ?? 5177);
const apiPort = Number(process.env.MN_API_PORT ?? 8104);
const baseURL = `http://localhost:${port}`;
const webDir = fileURLToPath(new URL('../..', import.meta.url));
const serverDir = fileURLToPath(new URL('../../../server', import.meta.url));
const dataDir = `/tmp/mn-real-${apiPort}`;
const viteConfig = process.env.MN_VITE_CONFIG ? ` --config ${process.env.MN_VITE_CONFIG}` : '';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.real\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      // registry 用 make_registry.py 生成：arxiv 插件换成本地假 MCP 服务（不联网），供“安装插件 → 输入框插件区”这一步
      command: `rm -rf ${dataDir} && mkdir -p ${dataDir} && .venv/bin/python ${webDir}tests/e2e-real/make_registry.py ${dataDir}/registry && MN_DATA_DIR=${dataDir} MN_REGISTRY_DIR=${dataDir}/registry MN_SKILLS_DIR=${dataDir}/skills MN_EMBED_BACKEND=fake env -u MN_LLM_BACKEND -u MN_LLM_API_BASE -u MN_LLM_API_KEY -u MN_LLM_MODEL -u MN_SETTINGS_PATH .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: serverDir,
      url: `http://127.0.0.1:${apiPort}/api/projects`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `MN_BACKEND=http://127.0.0.1:${apiPort} npx vite${viteConfig} --port ${port} --strictPort`,
      cwd: webDir,
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
