// 规格：1-助手回答-步骤行（chat.step-trail）
// 回答顶部一行：“› 检索 2 份材料、1 个网页，参考 1 段历史对话 · 3 步 · 9 秒”（秒数为整轮耗时，编排决定 U35）。点击展开每一步（图标、label、状态、耗时）与本轮证据。
// running：摘要后转圈并显示当前步骤 label；有 error 步骤：该步红色、摘要末尾“1 步失败”；verifying：末尾“核对引用…”；无步骤不渲染。
// 记忆相关步骤只说“参考 N 段历史对话”，不出现“记忆”二字。
import { memo, useState } from 'react';
import type { Evidence, ID, Step } from '../api/types';
import { ChevronIcon, DotIcon } from '../icons/ChatIcons';
import { Spinner } from '../icons/Icons';
import { labelNumber } from '../lib/citations';
import { chipTone, longPosition, TONE_CLASS } from '../lib/evidenceDisplay';
import { STEP_KIND_NAME, summarizeSteps } from '../lib/steps';
import { useLeafId } from '../branch/leafContext';
import { openEvidence } from './EvidenceChip';

interface Props {
  messageId: ID;
  steps: Step[];
  /** 本轮证据（流式中来自 SSE；历史消息为已加载到的证据） */
  evidence: Evidence[];
  verifying: boolean;
  /** 整轮耗时（毫秒，U35）；未知时不显示秒数 */
  latencyMs?: number;
}

const fmtMs = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} 秒`);

function StepTrail({ messageId, steps, evidence, verifying, latencyMs }: Props) {
  const [open, setOpen] = useState(false);
  const leafId = useLeafId(); // F5：分支面板里打开证据带 leaf_id
  if (steps.length === 0) return null;
  const s = summarizeSteps(steps, evidence, latencyMs);
  const detailId = `step-detail-${messageId}`;

  return (
    <div className="mb-3 rounded-card border border-line bg-surface">
      <button
        type="button"
        data-testid={`chat.step-trail:${messageId}`}
        data-state={s.running ? 'running' : s.failed ? 'error' : verifying ? 'verifying' : 'done'}
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        className="mn-focus flex w-full items-center gap-2 rounded-card px-3 py-2 text-left text-[12.8px] text-ink-2"
      >
        <ChevronIcon dir={open ? 'down' : 'right'} size={14} className="text-muted" />
        {!s.running && <span className="min-w-0 truncate">{s.text}</span>}
        {s.running && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Spinner size={12} className="text-muted" />
            <span className="truncate">{s.running.label}</span>
          </span>
        )}
        <span className="flex-1" />
        <span className="flex-none whitespace-nowrap text-[12px] text-muted">
          {s.count} 步{s.seconds > 0 ? ` · ${s.seconds} 秒` : ''}
          {s.failed > 0 && <span className="text-danger"> · {s.failed} 步失败</span>}
          {verifying && !s.running && <span> · 核对引用…</span>}
        </span>
      </button>
      {open && (
        <div
          id={detailId}
          data-testid={`chat.step-trail.detail:${messageId}`}
          className="border-t border-line-2 px-3 py-2"
        >
          <ol className="space-y-1">
            {steps.map((st) => (
              <li
                key={st.step_id}
                data-testid={`chat.step-trail.step:${st.step_id}`}
                data-status={st.status}
                className={`flex items-center gap-2 text-[12.5px] ${st.status === 'error' ? 'text-danger' : 'text-ink-2'}`}
              >
                {st.status === 'running' ? (
                  <Spinner size={11} className="text-muted" />
                ) : (
                  <DotIcon className={st.status === 'error' ? 'text-danger' : 'text-ok'} />
                )}
                <span className="w-[64px] flex-none text-[11.5px] text-muted">{STEP_KIND_NAME[st.kind]}</span>
                <span className="min-w-0 flex-1 truncate">{st.label}</span>
                <span className="flex-none text-[11.5px] text-muted">
                  {st.status === 'running' ? '进行中' : st.status === 'error' ? '失败' : fmtMs(st.duration_ms)}
                </span>
              </li>
            ))}
          </ol>
          {evidence.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5 border-t border-line-2 pt-2">
              {evidence.map((ev) => (
                <li key={ev.id}>
                  <button
                    type="button"
                    data-testid={`chat.step-trail.evidence:${ev.id}`}
                    onClick={() => openEvidence(ev.id, messageId, ev, leafId)}
                    className={`mn-focus inline-flex max-w-[260px] items-center gap-1 rounded-chip px-1.5 py-0.5 text-[11.5px] ${
                      TONE_CLASS[chipTone(ev.source_type)]
                    }`}
                  >
                    <span className="font-medium">{ev.label ? labelNumber(ev.label) : '·'}</span>
                    <span className="truncate">{ev.title}</span>
                    <span className="flex-none opacity-75">{longPosition(ev)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(StepTrail);
