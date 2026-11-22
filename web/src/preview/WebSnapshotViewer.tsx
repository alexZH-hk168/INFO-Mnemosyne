// 规格：2-证据胶囊-网页快照预览（right.web-preview）
// 显示抓取时保存的网页正文快照：纯文本排版，不用 iframe、不加载原网页（未决 U6）。顶部原 URL、抓取时间、“打开原网页”。
// 入口：证据胶囊（网页）/ 网页来源行，tab kind=web，ref_id=snapshot_id，locator.char_range。接口：['snapshot', sid]。
import { useEffect, useRef } from 'react';
import { ApiRequestError } from '../api/client';
import { useSnapshot } from '../api/queries';
import { ExternalIcon } from '../icons/PreviewIcons';
import { GlobeIcon } from '../icons/Icons';
import type { Tab } from '../store/layout';
import { useEvidence } from '../store/evidence';
import HighlightedText from './HighlightedText';
import { useTabEvidence } from './useEvidenceContext';

export function formatFetchedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function WebSnapshotViewer({ tab }: { tab: Tab }) {
  const snap = useSnapshot(tab.ref_id);
  const ev = useTabEvidence(tab);
  const nonce = useEvidence((s) => s.messageEvidence);
  const markRef = useRef<HTMLElement>(null);
  const loc = (ev?.locator ?? {}) as { char_range?: unknown };
  const range =
    Array.isArray(loc.char_range) && loc.char_range.length === 2 ? (loc.char_range as [number, number]) : null;

  useEffect(() => {
    if (snap.data && range) markRef.current?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.data, range?.[0], range?.[1], nonce]);

  const err = snap.error instanceof ApiRequestError ? snap.error : null;
  return (
    <div
      data-testid="right.web-preview"
      data-state={snap.isLoading ? 'loading' : snap.error ? 'error' : 'ready'}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      {snap.data && (
        <header className="flex flex-none items-start gap-2 border-b border-line px-4 py-2.5">
          <GlobeIcon size={15} className="mt-0.5 text-evi-web-ink" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-ink">{snap.data.title}</div>
            <div
              data-testid="right.web-preview.url"
              className="truncate text-[11.5px] text-muted"
              title={snap.data.url}
            >
              {snap.data.url}
            </div>
            <div data-testid="right.web-preview.fetched-at" className="text-[11.5px] text-faint">
              抓取于 {formatFetchedAt(snap.data.fetched_at)}
            </div>
          </div>
          <button
            type="button"
            data-testid="right.web-preview.open-original"
            onClick={() => window.open(snap.data.url, '_blank', 'noopener')}
            className="mn-focus flex flex-none items-center gap-1 rounded-btn border border-line px-2 py-1 text-[12px] text-ink-2 hover:bg-panel"
          >
            <ExternalIcon size={13} />
            打开原网页
          </button>
        </header>
      )}
      <div tabIndex={0} aria-label="网页快照正文" className="mn-focus min-h-0 flex-1 overflow-auto px-5 py-3">
        {snap.isLoading && (
          <div data-testid="right.web-preview.loading" aria-busy="true" className="flex flex-col gap-2">
            {[90, 75, 85, 60].map((w, i) => (
              <div key={i} className="mn-skel h-3.5" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {snap.error && (
          <div data-testid="right.web-preview.error" role="alert" className="py-8 text-center text-[13px] text-muted">
            {err?.code === 'NOT_VISIBLE_ON_PATH'
              ? '这个网页不在当前分支的可见范围内'
              : `快照加载失败：${(snap.error as Error).message}`}
          </div>
        )}
        {snap.data && (
          <article data-testid="right.web-preview.text" className="text-[13.5px] leading-[1.8] text-ink-2">
            <HighlightedText
              ref={markRef}
              text={snap.data.text}
              range={range}
              markTestid="right.web-preview.highlight"
            />
          </article>
        )}
      </div>
    </div>
  );
}
