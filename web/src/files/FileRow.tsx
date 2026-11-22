// 规格：1-文件分组-文件行（files.file-row）＋ 1-文件行-解析失败重试（files.reparse）
// 类型色块、文件名、右侧元信息。解析中不可点开预览；失败时文件名旁红点（悬停显示 parse_error）、右侧“重试”。
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DragEvent } from 'react';
import { api } from '../api/client';
import type { JobResult } from '../api/endpoints';
import { queryKeys } from '../api/queries';
import type { Document } from '../api/types';
import { badgeOf, metaOf, tabFor, tabKindOf } from '../lib/documents';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';

/** 文件行拖到输入框时携带的数据类型（F3 的输入框按它识别 @ 引用） */
export const DOC_DRAG_TYPE = 'application/x-mn-document';

export function TypeBadge({ doc }: { doc: Pick<Document, 'kind' | 'title'> }) {
  const b = badgeOf(doc);
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 flex-none items-center justify-center rounded-[3px] text-[7.5px] font-bold tracking-[-0.2px] text-surface ${b.cls}`}
    >
      {b.label}
    </span>
  );
}

function ReparseButton({ doc }: { doc: Document }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post<JobResult>(`/api/documents/${encodeURIComponent(doc.id)}/reparse`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.documents(doc.project_id) }),
    onError: (e) => useUI.getState().pushToast({ kind: 'error', text: `重新解析失败：${(e as Error).message}` }),
  });
  return (
    <button
      type="button"
      data-testid={`files.reparse:${doc.id}`}
      aria-label={`重新解析 ${doc.title}`}
      disabled={m.isPending}
      onClick={() => m.mutate()}
      className="mn-focus flex-none rounded-btn-sm px-1 text-[11px] text-ink-2 hover:text-ink disabled:text-faint"
    >
      重试
    </button>
  );
}

export default function FileRow({ document: doc }: { document: Document }) {
  const openTab = useLayout((s) => s.openTab);
  const tab = tabFor(tabKindOf(doc), doc.id, doc.title);
  const selected = useLayout((s) => s.activeTab === tab.id && s.rightTabs.some((t) => t.id === tab.id));
  const ready = doc.parse_status === 'ready';
  const failed = doc.parse_status === 'failed';
  const meta = metaOf(doc);

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DOC_DRAG_TYPE, doc.id);
    e.dataTransfer.setData('text/plain', doc.title);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      data-status={doc.parse_status}
      className={`flex items-center gap-1 rounded-btn-sm pr-1 text-[12.8px] ${
        selected ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink-2'
      }`}
    >
      <button
        type="button"
        data-testid={`files.file-row:${doc.id}`}
        aria-disabled={!ready || undefined}
        aria-current={selected ? 'true' : undefined}
        title={failed ? (doc.parse_error ?? '解析失败') : doc.title}
        draggable={ready}
        onDragStart={onDragStart}
        onClick={() => {
          if (ready) openTab(tab);
        }}
        className={`mn-focus flex min-w-0 flex-1 items-center gap-2 rounded-btn-sm py-[5px] pl-2 text-left ${
          ready ? 'cursor-pointer' : 'cursor-default'
        } ${!ready && !failed ? 'text-muted' : ''}`}
      >
        <TypeBadge doc={doc} />
        <span className="min-w-0 truncate">{doc.title}</span>
        {failed && (
          <span
            data-testid={`files.file-row.error-dot:${doc.id}`}
            aria-label={`解析失败：${doc.parse_error ?? ''}`}
            className="h-1.5 w-1.5 flex-none rounded-pill bg-danger"
          />
        )}
        <span className="flex-1" />
        {meta && (
          <span
            data-testid={`files.file-row.meta:${doc.id}`}
            className={`flex-none whitespace-nowrap pr-1 text-[11px] ${ready ? 'text-ok' : 'text-muted'}`}
          >
            {meta}
          </span>
        )}
      </button>
      {failed && <ReparseButton doc={doc} />}
    </div>
  );
}
