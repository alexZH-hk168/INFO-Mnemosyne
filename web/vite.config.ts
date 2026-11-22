import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * 连真实后端（B1 起）：`MN_BACKEND=http://localhost:8100 npm run dev`
 * 设了 MN_BACKEND 时关闭 MSW（等同 VITE_USE_MSW=false），并把 /api 代理到该地址；
 * 不设时行为不变，仍走 MSW 模拟接口。
 */
const backend = process.env.MN_BACKEND;

export default defineConfig({
  plugins: [react()],
  ...(backend ? { define: { 'import.meta.env.VITE_USE_MSW': JSON.stringify('false') } } : {}),
  server: {
    port: 5170,
    strictPort: true,
    // MSW 在浏览器里读 docs/contract/fixtures/*.json，需要允许访问 web/ 之外的仓库目录
    fs: { allow: [repoRoot] },
    ...(backend ? { proxy: { '/api': { target: backend, changeOrigin: true } } } : {}),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 15000,
  },
});
