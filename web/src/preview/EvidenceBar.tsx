// 规格：2-预览-证据栏（right.evidence-bar）
// 预览顶部的证据条：“证据 1 · 第 4 页 · 被主线第 1 条回答引用”，右侧“‹ 1/3 ›”在同一回答的证据之间切换（可能换标签）。
// 颜色随证据来源：材料琥珀、网页/插件蓝、历史对话灰。从文件栏直接打开的预览不显示（由 RightPane 判断）。
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import type { Evidence, ID } from '../api/types';
import { ChevronIcon } from '../icons/ChatIcons';
import { chipTone, type ChipTone } from '../lib/evidenceDisplay';
import { useChat } from '../store/chat';
import { useEvidence } from '../store/evidence';
import { evidenceNumber } from './evidenceModel';
import { evidenceBarText, useAnswerContext, useSyncMessageEvidence } from './useEvidenceContext';

const TONE: Record<ChipTone, string> = {
  material: 'bg-[var(--evi-bar-bg)] text-evi-ink',
  web: 'bg-[var(--evi-bar-web-bg)] text-evi-web-ink',
  message: 'bg-[var(--evi-bar-msg-bg)] text-evi-msg-ink',
};

/** 证据栏图标：引号 */
function QuoteMark() {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} aria-hidden="true" className="flex-none" fill="currentColor">
      <path d="M3 9.5C3 7 4.3 5.2 6.6 4.5l.4.9C5.6 6 5 7 5 8h1.6c.5 0 .9.4.9.9v2.2c0 .5-.4.9-.9.9H3.9a.9.9 0 0 1-.9-.9V9.5Zm5.5 0c0-2.5 1.3-4.3 3.6-5l.4.9c-1.4.6-2 1.6-2 2.6h1.6c.5 0 .9.4.9.9v2.2c0 .5-.4.9-.9.9H9.4a.9.9 0 0 1-.9-.9V9.5Z" />
    </svg>
  );
}

export default function EvidenceBar({ evidence }: { evidence: Evidence }) {
  const qc = useQueryClient();
  const select = useEvidence((s) => s.select);
  const { messageId, citations, ids, answer } = useAnswerContext();
  useSyncMessageEvidence(ids);

  const list = ids.length ? ids : [evidence.id];
  const index = Math.max(0, list.indexOf(evidence.id));
  const number = evidenceNumber(citations, evidence.id);
  const text = evidenceBarText(evidence, number, answer);
  const tone = chipTone(evidence.source_type);

  const go = async (eid: ID) => {
    if (!messageId) return;
    const st = useChat.getState().streaming;
    const local = st && st.message_id === messageId ? st.evidence.find((e) => e.id === eid) : undefined;
    const ev =
      local ??
      (await qc.fetchQuery({
        queryKey: queryKeys.evidence(eid),
        queryFn: ({ signal }) => api.get<Evidence>(`/api/evidence/${encodeURIComponent(eid)}`, { signal }),
      }));
    select(eid, messageId, { evidence: ev, evidenceIds: list });
  };

  return (
    <div
      data-testid="right.evidence-bar"
      data-tone={tone}
      className={`flex h-9 flex-none items-center gap-2 border-b border-line px-3 text-[12.5px] ${TONE[tone]}`}
    >
      <QuoteMark />
      <span data-testid="right.evidence-bar.text" className="min-w-0 flex-1 truncate">
        <b className="font-semibold">{text.split(' · ')[0]}</b>
        {text.slice(text.split(' · ')[0].length)}
      </span>
      {list.length > 1 && (
        <div className="flex flex-none items-center gap-0.5">
          <button
            type="button"
            data-testid="right.evidence-bar.prev"
            aria-label="上一条证据"
            disabled={index === 0}
            onClick={() => void go(list[index - 1])}
            className="mn-focus rounded-btn-sm p-0.5 hover:bg-surface disabled:opacity-35"
          >
            <ChevronIcon dir="left" size={14} />
          </button>
          <span data-testid="right.evidence-bar.count" className="min-w-[30px] text-center tabular-nums">
            {index + 1} / {list.length}
          </span>
          <button
            type="button"
            data-testid="right.evidence-bar.next"
            aria-label="下一条证据"
            disabled={index >= list.length - 1}
            onClick={() => void go(list[index + 1])}
            className="mn-focus rounded-btn-sm p-0.5 hover:bg-surface disabled:opacity-35"
          >
            <ChevronIcon dir="right" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
