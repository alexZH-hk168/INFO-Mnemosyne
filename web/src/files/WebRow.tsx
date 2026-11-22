// 规格：1-文件分组-网页来源行（files.web-row）
// 对话中联网抓取并保存了快照的网页（不是用户上传）：地球图标、网页标题、右侧“引用 N”。点击在右栏打开快照。
import type { Document } from '../api/types';
import { GlobeIcon } from '../icons/Icons';
import { tabFor } from '../lib/documents';
import { useLayout } from '../store/layout';

export default function WebRow({ document: doc }: { document: Document }) {
  const openTab = useLayout((s) => s.openTab);
  const sid = doc.snapshot_id;
  const tab = sid ? tabFor('web', sid, doc.title) : null;
  const selected = useLayout((s) => !!tab && s.activeTab === tab.id && s.rightTabs.some((t) => t.id === tab.id));
  return (
    <button
      type="button"
      data-testid={`files.web-row:${doc.id}`}
      aria-current={selected ? 'true' : undefined}
      disabled={!tab}
      title={doc.title}
      onClick={() => tab && openTab(tab)}
      className={`mn-focus flex w-full items-center gap-2 rounded-btn-sm px-2 py-[5px] text-left text-[12.8px] ${
        selected ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink-2'
      }`}
    >
      <span
        aria-hidden="true"
        className="flex h-4 w-4 flex-none items-center justify-center rounded-[3px] border border-line bg-surface text-muted"
      >
        <GlobeIcon size={11} />
      </span>
      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
      <span className="flex-none whitespace-nowrap text-[11px] text-faint">引用 {doc.cited_count}</span>
    </button>
  );
}
