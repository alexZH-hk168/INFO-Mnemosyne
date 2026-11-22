// 主页输入框草稿写入。编排决定 U25：改为调用 useChat.setDraft（F3 增加）。
import { MAIN, useChat } from '../store/chat';

export function setMainDraftText(text: string) {
  useChat.getState().setDraft(MAIN, { text });
}
