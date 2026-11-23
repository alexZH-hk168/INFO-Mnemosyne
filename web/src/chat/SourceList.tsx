// 规格：1-助手回答-来源列表（chat.source-list）
// 回答保存后下方一排来源卡：类型图标＋“1 · Attention Is All You Need · p.4”。只列 supported 与 partial 的证据；超过 4 个折叠为“+N”。
// 点击同点击对应胶囊（useEvidence.select）。
import { memo, useState } from 'react';
import { useEvidence as useEvidenceQuery } from '../api/queries';
import type { Citation, ID } from '../api/types';
import { TypeBadge } from '../files/FileRow';
import { BubbleIcon } from '../icons/ChatIcons';
import { GlobeIcon, PuzzleIcon } from '../icons/Icons';
import { labelNumber } from '../lib/citations';
import { chipPosition, sourceKind } from '../lib/evidenceDisplay';
import { useEvidence } from '../store/evidence';
import { useLeafId } from '../branch/leafContext';
import { openEvidence, useLocalEvidence } from './EvidenceChip';

const MAX_VISIBLE = 4;

function SourceCard({ messageId, citation }: { messageId: ID; citation: Citation }) {
  const local = useLocalEvidence(messageId, citation.eid, citation.label);
  const leafId = useLeafId(); // F5：分支面板里带 leaf_id（v1 分支面板不显示来源列表，保持与胶囊一致）
  const remote = useEvidenceQuery(local ? null : citation.eid, leafId);
  const ev = local ?? remote.data;
  const selected = useEvidence((s) => s.selectedEvidenceId === citation.eid);
  const num = labelNumber(citation.label);
  const kind = ev ? sourceKind(ev) : null;
  const pos = ev ? chipPosition(ev) : '';
  const icon =
    kind === 'pdf' ? (
      <TypeBadge doc={{ kind: 'pdf', title: ev!.title }} />
    ) : kind === 'pptx' ? (
      <TypeBadge doc={{ kind: 'pptx', title: ev!.title }} />
    ) : kind === 'code' ? (
      <TypeBadge doc={{ kind: 'code', title: ev!.title }} />
    ) : kind === 'web' ? (
      <GlobeIcon size={14} className="text-evi-web-ink" />
    ) : kind === 'message' ? (
      <BubbleIcon size={14} className="text-evi-msg-ink" />
    ) : kind === 'plugin' ? (
      <PuzzleIcon size={14} className="text-evi-web-ink" />
    ) : (
      <span className="mn-skel h-4 w-4" />
    );
  return (
    <button
      type="button"
      data-testid={`chat.source-list.item:${citation.eid}`}
      data-verdict={citation.verdict}
      aria-pressed={selected}
      onClick={() => openEvidence(citation.eid, messageId, ev, leafId)}
      className={`mn-focus inline-flex max-w-[280px] items-center gap-1.5 rounded-btn border bg-surface px-2 py-1 text-[12px] text-ink-2 hover:border-faint ${
        selected ? 'border-evi-ring' : 'border-line'
      }`}
    >
      {icon}
      <span className="min-w-0 truncate">
        {num} · {ev?.title ?? '…'}
        {pos ? ` · ${pos}` : ''}
      </span>
    </button>
  );
}

function SourceList({ messageId, citations }: { messageId: ID; citations: Citation[] }) {
  const [expanded, setExpanded] = useState(false);
  // 同一证据被多句引用只列一次；按序号排
  const seen = new Set<ID>();
  const list = citations
    .filter((c) => c.verdict === 'supported' || c.verdict === 'partial')
    .filter((c) => (seen.has(c.eid) ? false : (seen.add(c.eid), true)))
    .sort((a, b) => Number(labelNumber(a.label)) - Number(labelNumber(b.label)));
  if (list.length === 0) return null;
  const shown = expanded ? list : list.slice(0, MAX_VISIBLE);
  const hidden = list.length - shown.length;
  return (
    <div data-testid={`chat.source-list:${messageId}`} className="mt-3 flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <SourceCard key={c.eid} messageId={messageId} citation={c} />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          data-testid={`chat.source-list.more:${messageId}`}
          onClick={() => setExpanded(true)}
          className="mn-focus rounded-btn border border-line bg-surface px-2 py-1 text-[12px] text-muted hover:text-ink"
        >
          +{hidden}
        </button>
      )}
    </div>
  );
}

export default memo(SourceList);
