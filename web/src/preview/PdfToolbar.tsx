// 规格：2-PDF预览-工具条（right.pdf-toolbar）
// “第 4 / 15 页 | 100%”与缩小、放大、查找、下载按钮；查找打开页内查找条。只用组件内部 state（规格“读写的前端状态：无全局状态”）。
// 缩放 50%–200%，100% 为适应右栏宽度（UI-06 的 100% 即整页铺满预览区宽度）。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronIcon } from '../icons/ChatIcons';
import { CloseIcon } from '../icons/Icons';
import { DownloadIcon, SearchIcon, ZoomInIcon, ZoomOutIcon } from '../icons/PreviewIcons';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
}

export interface FindState {
  open: boolean;
  query: string;
  total: number;
  active: number;
  searching: boolean;
}

interface Props {
  page: number;
  pages: number;
  zoom: number;
  onPage: (n: number) => void;
  onZoom: (z: number) => void;
  onDownload: () => void;
  downloading?: boolean;
  find: FindState;
  onFind: (patch: Partial<FindState>) => void;
  onFindStep: (dir: 1 | -1) => void;
  /** 幻灯片模式不显示缩放外的差异，按钮同一套 */
  disabled?: boolean;
}

const ICON_BTN =
  'mn-focus flex h-7 w-7 items-center justify-center rounded-btn-sm text-muted hover:bg-sel hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent';

export default function PdfToolbar({
  page,
  pages,
  zoom,
  onPage,
  onZoom,
  onDownload,
  downloading,
  find,
  onFind,
  onFindStep,
  disabled,
}: Props) {
  const [draft, setDraft] = useState(String(page));
  const findRef = useRef<HTMLInputElement>(null);
  const findBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setDraft(String(page)), [page]);
  useEffect(() => {
    if (find.open) findRef.current?.focus();
  }, [find.open]);

  const commitPage = () => {
    const n = Number.parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 1 && n <= pages) onPage(n);
    else setDraft(String(page));
  };
  const onPageKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitPage();
    if (e.key === 'Escape') setDraft(String(page));
  };
  const closeFind = () => {
    onFind({ open: false, query: '' });
    findBtnRef.current?.focus();
  };
  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onFindStep(e.shiftKey ? -1 : 1);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFind();
    }
  };

  return (
    <div data-testid="right.pdf-toolbar" className="flex-none border-b border-line bg-surface">
      <div className="flex h-10 items-center gap-1 px-3 text-[12.5px] text-ink-2">
        <label className="flex items-center gap-1">
          <span>第</span>
          <input
            data-testid="right.pdf-toolbar.page"
            aria-label="页码，回车跳转"
            inputMode="numeric"
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={onPageKey}
            onBlur={() => setDraft(String(page))}
            className="mn-focus h-6 w-8 rounded-btn-sm border border-transparent bg-transparent text-center tabular-nums hover:border-line focus:border-line"
          />
          <span data-testid="right.pdf-toolbar.pages" className="tabular-nums">
            / {pages} 页
          </span>
        </label>
        <span aria-hidden="true" className="mx-2 h-3.5 w-px bg-line" />
        <span data-testid="right.pdf-toolbar.zoom" className="min-w-[38px] tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            data-testid="right.pdf-toolbar.zoom-out"
            aria-label="缩小"
            title="缩小"
            disabled={disabled || zoom <= ZOOM_MIN}
            onClick={() => onZoom(clampZoom(zoom - ZOOM_STEP))}
            className={ICON_BTN}
          >
            <ZoomOutIcon />
          </button>
          <button
            type="button"
            data-testid="right.pdf-toolbar.zoom-in"
            aria-label="放大"
            title="放大"
            disabled={disabled || zoom >= ZOOM_MAX}
            onClick={() => onZoom(clampZoom(zoom + ZOOM_STEP))}
            className={ICON_BTN}
          >
            <ZoomInIcon />
          </button>
          <button
            ref={findBtnRef}
            type="button"
            data-testid="right.pdf-toolbar.find"
            aria-label="页内查找"
            title="页内查找"
            aria-expanded={find.open}
            disabled={disabled}
            onClick={() => (find.open ? closeFind() : onFind({ open: true }))}
            className={`${ICON_BTN} ${find.open ? 'bg-sel text-ink' : ''}`}
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            data-testid="right.pdf-toolbar.download"
            aria-label="下载原文件"
            title="下载原文件"
            disabled={disabled || downloading}
            onClick={onDownload}
            className={ICON_BTN}
          >
            <DownloadIcon />
          </button>
        </div>
      </div>
      {find.open && (
        <div
          data-testid="right.pdf-toolbar.find-bar"
          role="search"
          className="flex h-9 items-center gap-1.5 border-t border-line-2 px-3 text-[12.5px]"
        >
          <input
            ref={findRef}
            data-testid="right.pdf-toolbar.find-input"
            aria-label="查找文字"
            placeholder="在文档中查找"
            value={find.query}
            onChange={(e) => onFind({ query: e.target.value })}
            onKeyDown={onFindKey}
            className="mn-focus h-6 min-w-0 flex-1 rounded-btn-sm border border-line bg-surface px-2 text-ink placeholder:text-faint"
          />
          <span data-testid="right.pdf-toolbar.find-count" aria-live="polite" className="min-w-[48px] text-muted">
            {find.query.trim()
              ? find.searching
                ? '查找中…'
                : find.total
                  ? `${find.active + 1} / ${find.total}`
                  : '无结果'
              : ''}
          </span>
          <button
            type="button"
            data-testid="right.pdf-toolbar.find-prev"
            aria-label="上一个"
            disabled={!find.total}
            onClick={() => onFindStep(-1)}
            className={ICON_BTN}
          >
            <ChevronIcon dir="up" size={14} />
          </button>
          <button
            type="button"
            data-testid="right.pdf-toolbar.find-next"
            aria-label="下一个"
            disabled={!find.total}
            onClick={() => onFindStep(1)}
            className={ICON_BTN}
          >
            <ChevronIcon dir="down" size={14} />
          </button>
          <button
            type="button"
            data-testid="right.pdf-toolbar.find-close"
            aria-label="关闭查找"
            onClick={closeFind}
            className={ICON_BTN}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
