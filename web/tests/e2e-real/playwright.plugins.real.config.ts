import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * [VER1] 真实插件冒烟（可选）：后端用仓库里的真实 registry（不走 make_registry.py 的假 MCP），
 * 经市场真实安装 arxiv-mcp-server@0.8.2 与 mcp-server-fetch，在对话里各调一次真实工具，
 * 点证据胶囊打开右栏“插件结果卡片”和“网页快照”。模型仍是演示模式的确定性假模型（不产生费用），
 * 但插件本身要联网（PyPI、arXiv）。默认不跑：用例在 MN_REAL_PLUGINS=1 之外直接跳过。
 *
 * 用法（在 web/ 下）：
 *   MN_REAL_PLUGINS=1 MN_PORT=5182 MN_API_PORT=8107 npx playwright test -c tests/e2e-real/playwright.plugins.real.config.ts
 * 两个服务都由本配置拉起（已在跑就复用）。后端每次用全新的临时数据目录 /tmp/mn-realplug-<端口>。
 * 首次运行 uv 缓存为空时，安装要先下载插件依赖（约 100 MB），时长取决于网络，见 server 的 MN_PLUGIN_INSTALL_TIMEOUT_S。
 * MN_VITE_CONFIG：可选，Vite 配置文件（worktree 里 node_modules 是软链时用本地 *.local 配置放开 fs.allow）。
 */
const executablePath = process.env.MN_CHROMIUM ?? '/usr/local/lib/lightread-playwright/bin/chromium';
const port = Number(process.env.MN_PORT ?? 5177);
const apiPort = Number(process.env.MN_API_PORT ?? 8104);
const baseURL = `http://localhost:${port}`;
const webDir = fileURLToPath(new URL('../..', import.meta.url));
const serverDir = fileURLToPath(new URL('../../../server', import.meta.url));
const dataDir = `/tmp/mn-realplug-${apiPort}`;
const viteConfig = process.env.MN_VITE_CONFIG ? ` --config ${process.env.MN_VITE_CONFIG}` : '';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.real-plugins\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: `rm -rf ${dataDir} && mkdir -p ${dataDir} && MN_DATA_DIR=${dataDir} MN_SKILLS_DIR=${dataDir}/skills MN_EMBED_BACKEND=fake env -u MN_REGISTRY_DIR -u MN_LLM_BACKEND -u MN_LLM_API_BASE -u MN_LLM_API_KEY -u MN_LLM_MODEL -u MN_SETTINGS_PATH .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port ${apiPort}`,
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
