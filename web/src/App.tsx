// 规格：无（F0 占位页，只用来确认 tokens、字体与 MSW 生效；F2 用主页替换）。
import { useProjects } from './api/queries';

const SWATCHES = [
  'canvas',
  'panel',
  'panel-2',
  'surface',
  'line',
  'line-2',
  'ink',
  'ink-2',
  'muted',
  'faint',
  'sel',
  'evi-bg',
  'evi-ink',
  'evi-hl',
  'evi-web-bg',
  'evi-web-ink',
  'evi-msg-bg',
  'evi-msg-ink',
  'ok',
] as const;

const CHIPS = [
  { label: '材料', cls: 'bg-evi-bg text-evi-ink' },
  { label: '网页', cls: 'bg-evi-web-bg text-evi-web-ink' },
  { label: '历史对话', cls: 'bg-evi-msg-bg text-evi-msg-ink' },
] as const;

export default function App() {
  const projects = useProjects();
  const mswStatus = projects.isPending
    ? '正在请求 /api/projects…'
    : projects.isError
      ? `请求失败：${projects.error.message}`
      : `MSW 已接管：/api/projects 返回 ${projects.data.projects.length} 个项目`;

  return (
    <main data-testid="f0.placeholder" className="min-h-full bg-canvas p-10 text-ink">
      <div className="mx-auto max-w-5xl rounded-panel border border-line bg-panel p-8">
        <h1 className="font-serif text-4xl font-semibold tracking-tight">Mnemosyne</h1>
        <p className="mt-2 text-sm text-muted">F0 占位页：设计 token、字体与模拟接口。正式主页在 F2 实现。</p>

        <section className="mt-8 grid grid-cols-2 gap-6">
          <div className="rounded-card border border-line bg-surface p-6">
            <h2 className="font-serif text-2xl font-semibold">今天要学习什么？</h2>
            <p className="mt-3 font-sans text-base text-ink-2">
              正文 Inter + Noto Sans SC：The quick brown fox jumps over the lazy dog. 汉字与 Latin 混排 0123456789。
            </p>
            <p className="mt-2 font-mono text-sm text-ink-2">代码 mono：const x = [0, 1, 2].map((n) =&gt; n * 2);</p>
            <div className="mt-4 flex gap-2">
              {CHIPS.map((c) => (
                <span key={c.label} className={`rounded-chip px-2 py-0.5 text-xs ${c.cls}`}>
                  {c.label}
                </span>
              ))}
              <span className="rounded-pill bg-ok px-3 py-0.5 text-xs text-surface">开关开启</span>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-btn border border-line bg-surface px-3 py-1.5 text-sm hover:bg-sel"
              >
                按钮 8px
              </button>
              <button type="button" className="rounded-btn-sm bg-ink px-3 py-1.5 text-sm text-surface">
                按钮 7px
              </button>
            </div>
          </div>

          <div className="rounded-card border border-line bg-surface p-6">
            <h2 className="font-serif text-lg font-semibold">颜色 token</h2>
            <ul className="mt-3 grid grid-cols-3 gap-2 text-xs text-ink-2">
              {SWATCHES.map((name) => (
                <li key={name} className="flex items-center gap-2">
                  <span
                    className="inline-block h-5 w-5 rounded-chip border border-line"
                    style={{ background: `var(--${name})` }}
                  />
                  <code className="font-mono">--{name}</code>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <p data-testid="f0.msw-status" className="mt-6 rounded-card-sm bg-panel-2 px-4 py-2 text-sm text-ink-2">
          {mswStatus}
        </p>
      </div>
    </main>
  );
}
