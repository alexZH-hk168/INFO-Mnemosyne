// 右栏读取“当前选中证据”及其所在回答的上下文（证据栏、各预览共用）。
import { useEffect, useMemo } from 'react';
import { useEvidence as useEvidenceQuery, useTree } from '../api/queries';
import type { Citation, Evidence, ID } from '../api/types';
import { longPosition } from '../lib/evidenceDisplay';
import { useChat } from '../store/chat';
import { tabForEvidence, useEvidence } from '../store/evidence';
import type { Tab } from '../store/layout';
import { answerEvidenceIds, describeAnswer, evidenceNumber } from './evidenceModel';

const NO_CITATIONS: Citation[] = [];

/** 某条证据：流式中/刚结束的回答用本地证据池，否则读 ['evidence', eid] */
export function useEvidenceById(eid: ID | null, messageId: ID | null) {
  const local = useChat((s) =>
    eid && s.streaming && s.streaming.message_id === messageId
      ? s.streaming.evidence.find((e) => e.id === eid)
      : undefined,
  );
  const q = useEvidenceQuery(local ? null : eid);
  return { evidence: local ?? q.data, error: local ? null : q.error, loading: !local && q.isLoading };
}

/** 当前选中的证据（useEvidence.selectedEvidenceId） */
export function useSelectedEvidence() {
  const eid = useEvidence((s) => s.selectedEvidenceId);
  const mid = useEvidence((s) => s.selectedMessageId);
  return { eid, messageId: mid, ...useEvidenceById(eid, mid) };
}

/** 选中证据正好对应这个标签时返回它（文件栏直接打开的预览不带证据） */
export function useTabEvidence(tab: Tab): Evidence | null {
  const { evidence } = useSelectedEvidence();
  return evidence && tabForEvidence(evidence).id === tab.id ? evidence : null;
}

/** 选中证据所在回答：引用列表、可切换的证据顺序、“被主线第 N 条回答引用” */
export function useAnswerContext() {
  const messageId = useEvidence((s) => s.selectedMessageId);
  const conversationId = useChat((s) => s.conversationId);
  const tree = useTree(conversationId);
  const streaming = useChat((s) => (s.streaming && s.streaming.message_id === messageId ? s.streaming : null));
  const turn = useChat((s) => s.turn);
  const treeMsg = messageId ? tree.data?.messages.find((m) => m.id === messageId) : undefined;
  const citations = streaming?.citations ?? treeMsg?.citations ?? NO_CITATIONS;
  const ids = useMemo(() => answerEvidenceIds(citations), [citations]);
  const answer = useMemo(() => {
    if (!messageId || !tree.data) return null;
    const pending =
      !treeMsg && streaming && turn
        ? turn.kind === 'regenerate'
          ? { parent_id: turn.user_message_id, branch_id: turn.branch_id }
          : { parent_id: turn.parent_id, branch_id: turn.branch_id }
        : undefined;
    return describeAnswer(tree.data.messages, tree.data.branches, messageId, pending);
  }, [messageId, tree.data, treeMsg, streaming, turn]);
  return { messageId, citations, ids, answer };
}

/** 证据栏一行字：“证据 1 · 第 4 页 · 被主线第 1 条回答引用” */
export function evidenceBarText(ev: Evidence, number: string | null, answer: string | null): string {
  const parts = [`证据 ${number ?? '?'}`];
  const pos = longPosition(ev);
  if (pos) parts.push(pos);
  if (answer) parts.push(`被${answer}引用`);
  return parts.join(' · ');
}

/** 选中证据在本回答里的序号（右侧“证据 N”标签与证据栏共用） */
export function useSelectedNumber(): string | null {
  const { eid } = useSelectedEvidence();
  const { citations } = useAnswerContext();
  return eid ? evidenceNumber(citations, eid) : null;
}

/** 把按引用算出的证据顺序写回 useEvidence.messageEvidence（历史消息的 select 只知道当前这一条） */
export function useSyncMessageEvidence(ids: ID[]) {
  const setMessageEvidence = useEvidence((s) => s.setMessageEvidence);
  useEffect(() => {
    if (ids.length) setMessageEvidence(ids);
  }, [ids, setMessageEvidence]);
}
