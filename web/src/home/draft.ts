// 主页输入框草稿写入（F2 临时；F3 正式输入框接手）。
import { emptyDraft, MAIN, useChat } from '../store/chat';

/**
 * useChat 目前没有改草稿的 action（state.md 只列了 composer 字段），F2 先用 setState 写 composer['main'].text。
 * 见 PROGRESS 未决（F2-2）：建议 F3 增加 setDraft(key, patch) 后改为调用它。
 */
export function setMainDraftText(text: string) {
  useChat.setState((s) => ({
    composer: { ...s.composer, [MAIN]: { ...(s.composer[MAIN] ?? emptyDraft()), text } },
  }));
}
