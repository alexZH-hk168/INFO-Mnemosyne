// F0 端到端：dev server + 浏览器端 MSW。验 tokens 与字体生效、REST/事件流在浏览器里都由 fixture 应答，并截图。
import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '../../../docs/contract/fixtures');
type Fx = {
  endpoint: string;
  kind: string;
  status: number;
  content_type?: string;
  body: unknown;
  events?: { event: string; data: { seq: number } }[];
  request?: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown; files?: string[] };
};
const fixtures = Object.fromEntries(
  readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f, JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) as Fx]),
);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('f0.msw-status')).toContainText('MSW 已接管');
});

test('占位页：tokens 与字体生效，并截图', async ({ page }) => {
  const placeholder = page.getByTestId('f0.placeholder');
  await expect(placeholder).toHaveCSS('background-color', 'rgb(251, 250, 248)'); // --canvas
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Noto Serif SC/);
  await expect(page.getByTestId('f0.msw-status')).toContainText(
    `返回 ${(fixtures['get-projects.ok.json'].body as { projects: unknown[] }).projects.length} 个项目`,
  );
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(async () => {
    const want = ['400 16px Inter', '400 16px "Noto Sans SC"', '600 16px "Noto Serif SC"'];
    await Promise.all(want.map((f) => document.fonts.load(f, '汉A')));
    return want.map((f) => [f, document.fonts.check(f, '汉A')]);
  });
  for (const [font, ok] of loaded) expect(ok, `${font} 未加载`).toBe(true);
  await page.screenshot({ path: 'tests/screenshots/F0-占位页-tokens.png', fullPage: false });
});

test('浏览器里每份 REST 成功/错误样例都由 MSW 按 fixture 应答', async ({ page }) => {
  const cases = Object.entries(fixtures).filter(([, fx]) => fx.kind === 'ok' || fx.kind === 'error');
  const results = await page.evaluate(async (list) => {
    const ctl = (
      window as unknown as {
        __mnMock: { setMockScenario: (e: string, s: string) => void; resetMockScenarios: () => void };
      }
    ).__mnMock;
    const out: { file: string; status: number; body: unknown }[] = [];
    for (const [file, fx] of list) {
      ctl.resetMockScenarios();
      ctl.setMockScenario(fx.endpoint, fx.kind === 'error' ? 'error' : file);
      const [method, rawPath] = fx.endpoint.split(' ');
      const path = rawPath.replace(/\{(\w+)\}/g, (_: string, k: string) =>
        encodeURIComponent(fx.request?.params?.[k] ?? 'x'),
      );
      const qs = new URLSearchParams(fx.request?.query ?? {}).toString();
      const init: RequestInit = { method };
      if (fx.request?.files) {
        const form = new FormData();
        for (const n of fx.request.files) form.append('file', new Blob(['x']), n);
        init.body = form;
      } else if (fx.request?.body !== undefined) {
        init.body = JSON.stringify(fx.request.body);
        init.headers = { 'Content-Type': 'application/json' };
      }
      const res = await fetch(`${path}${qs ? `?${qs}` : ''}`, init);
      const isJson = (res.headers.get('Content-Type') ?? '').includes('json');
      out.push({ file, status: res.status, body: isJson ? await res.json() : await res.text() });
    }
    ctl.resetMockScenarios();
    return out;
  }, cases);
  expect(results).toHaveLength(cases.length);
  for (const r of results) {
    const fx = fixtures[r.file];
    expect(r.status, r.file).toBe(fx.status);
    expect(r.body, r.file).toEqual(fx.body);
  }
});

test('浏览器里事件流按 fixture 逐条读到', async ({ page }) => {
  const fx = fixtures['sse-turn-full.json'];
  const got = await page.evaluate(
    async (req) => {
      const res = await fetch(`/api/conversations/${req.params.cid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const seqs: number[] = [];
      const stamps: number[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (data) {
            seqs.push(JSON.parse(data).seq);
            stamps.push(performance.now());
          }
        }
      }
      return { type: res.headers.get('Content-Type'), seqs, span: stamps[stamps.length - 1] - stamps[0] };
    },
    fx.request as { params: { cid: string }; body: unknown },
  );
  expect(got.type).toContain('text/event-stream');
  expect(got.seqs).toEqual(fx.events!.map((e) => e.data.seq));
  expect(got.span).toBeGreaterThanOrEqual(80 * (fx.events!.length - 1) * 0.8);
});
