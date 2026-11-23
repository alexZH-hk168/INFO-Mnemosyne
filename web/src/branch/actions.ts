// F5：分支相关的动作（建分支、合并、打开分支标签、回到原处）。组件只调这里，接口与失效的 query key 按规格「接口」表。
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ActiveLeafResult, MergeResult } from '../api/endpoints';
import { queryKeys } from '../api/queries';
import type { Branch, ConversationTree, CreateBranchBody, ID } from '../api/types';
import { mainPath } from '../chat/MessageList';
import { tabFor } from '../lib/documents';
import { goConversation } from '../lib/nav';
import { useChat } from '../store/chat';
import { useLayout } from '../store/layout';

export const FLASH_EVENT = 'mn:flash-branch';
export const FLASH_MS = 1200;

/** 让某个分支的原句闪烁高亮 1.2 s（BranchMarkText 监听） */
export function flashBranch(bid: ID): void {
  window.dispatchEvent(new CustomEvent(FLASH_EVENT, { detail: { bid } }));
}

/** 右栏打开（或激活）某个分支标签：useLayout.openTab({kind:"branch", ref_id}) */
export function openBranchTab(b: Pick<Branch, 'id' | 'title'>): void {
  useLayout.getState().openTab(tabFor('branch', b.id, b.title));
}

/** 在已缓存的对话树里找分支所在的对话（分支标签可能来自别的对话） */
export function findBranchTree(qc: QueryClient, bid: ID): ConversationTree | undefined {
  for (const [, data] of qc.getQueriesData<ConversationTree>({ queryKey: ['tree'] })) {
    if (data?.branches.some((b) => b.id === bid)) return data;
  }
  return undefined;
}

function invalidateAfterBranchChange(qc: QueryClient, cid: ID) {
  void qc.invalidateQueries({ queryKey: queryKeys.tree(cid) });
  const pid = useChat.getState().projectId;
  if (pid) void qc.invalidateQueries({ queryKey: queryKeys.conversations(pid) });
}

/** POST /api/branches；成功后把分支写进树缓存（原句立刻出现标记），再失效 ['tree', cid] 与对话列表（分支数） */
export async function createBranch(qc: QueryClient, body: CreateBranchBody): Promise<Branch> {
  const b = await api.post<Branch>('/api/branches', body);
  qc.setQueryData<ConversationTree>(queryKeys.tree(body.conversation_id), (old) =>
    old && !old.branches.some((x) => x.id === b.id) ? { ...old, branches: [...old.branches, b] } : old,
  );
  invalidateAfterBranchChange(qc, body.conversation_id);
  return b;
}

/** POST /api/branches/{bid}/merge；失效 ['tree', cid] */
export async function mergeBranch(qc: QueryClient, branch: Branch): Promise<MergeResult> {
  const res = await api.post<MergeResult>(`/api/branches/${encodeURIComponent(branch.id)}/merge`);
  qc.setQueryData<ConversationTree>(queryKeys.tree(branch.conversation_id), (old) =>
    old
      ? {
          ...old,
          branches: old.branches.map((b) => (b.id === res.branch.id ? res.branch : b)),
          messages: old.messages.some((m) => m.id === res.merge_note.id)
            ? old.messages
            : [...old.messages, res.merge_note],
          active_leaf_id: res.merge_note.id,
          conversation: { ...old.conversation, active_leaf_id: res.merge_note.id },
        }
      : old,
  );
  invalidateAfterBranchChange(qc, branch.conversation_id);
  return res;
}

const reduceMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 等对话栏里出现某个元素再滚过去（树刷新、切换兄弟回答后要等一两帧）；最多等约 2 s */
export function scrollChatTo(selector: string, block: ScrollLogicalPosition = 'center'): Promise<Element | null> {
  return new Promise((resolve) => {
    let tries = 0;
    const tick = () => {
      const el = document.querySelector(`[data-testid="chat.message-list"] ${selector}`);
      if (el) {
        el.scrollIntoView?.({ block, behavior: reduceMotion() ? 'auto' : 'smooth' });
        resolve(el);
        return;
      }
      tries += 1;
      if (tries > 40) resolve(null);
      else setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * 回到原处（规格 2-分支面板-来源原句与回到原处）：对话栏滚到 fork 消息的锚点并闪烁高亮 1.2 s。
 * fork 消息不在当前主线（兄弟回答已切换）时先 PUT active_leaf 切回去再滚。
 */
export async function goToAnchor(qc: QueryClient, branch: Branch): Promise<void> {
  const cid = branch.conversation_id;
  if (useChat.getState().conversationId !== cid || useLayout.getState().view !== 'conversation') goConversation(cid);
  const tree = qc.getQueryData<ConversationTree>(queryKeys.tree(cid));
  if (tree && !mainPath(tree).some((m) => m.id === branch.fork_message_id)) {
    await api.put<ActiveLeafResult>(`/api/conversations/${encodeURIComponent(cid)}/active_leaf`, {
      message_id: branch.fork_message_id,
    });
    await qc.invalidateQueries({ queryKey: queryKeys.tree(cid) });
  }
  const el = await scrollChatTo(`[data-mn-branch-ids~="${CSS.escape(branch.id)}"]`);
  if (el) flashBranch(branch.id);
}
