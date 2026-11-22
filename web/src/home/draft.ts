// 主页输入框草稿写入。编排决定 U25：改为调用 useChat.setDraft（F3 增加）；U37：主页草稿 key 为 `new:main`。
import { NEW_MAIN, useChat } from '../store/chat';

export function setMainDraftText(text: string) {
  useChat.getState().setDraft(NEW_MAIN, { text });
}
