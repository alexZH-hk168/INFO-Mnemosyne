// F5：分支面板里证据可见性用的叶子（契约 v0.4、编排决定 U44）。
// 分支面板把当前分支的叶子消息 id 放进这个 context；证据胶囊、来源列表、步骤行、悬停浮层在分支里读证据时带上 `leaf_id`，
// 并把它随 useEvidence.select 传给右栏预览。主线里为 null（不传，后端按 active_leaf_id 判断）。
import { createContext, useContext } from 'react';
import type { ID } from '../api/types';

export const LeafContext = createContext<ID | null>(null);

export const useLeafId = () => useContext(LeafContext);
