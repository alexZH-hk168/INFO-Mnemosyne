// [VER1] 进行中的一轮什么时候交给树渲染（MessageList 与分支面板共用）。
//
// 后端在回合开始时就插入一条 content 为空的助手消息，回合结束前才写回正文。回合进行中如果树被拉取
// （例如主页发出首条消息后跳到 /c/:cid，对话栏第一次加载树），树里就已经有这条空消息。原来的判断
// “树里出现这条消息就交给树”会在流式刚开始时就清掉 turn：之后的流式正文不再显示，回合结束时
// 对话栏因为 turn 已空也不会再刷新树，回答一直是空白，要刷新页面才出现（VER1 用真实插件发现：
// 插件调用让回合持续 1–3 秒，真实模型下几乎每个首轮都会这样）。
//
// 现在要同时满足：流式已结束（saved / cancelled / error），且树里那条消息不是回合中途拍下的空占位
// （正文非空，或流式本身也没有正文）。树还是旧的时，结束时的失效会触发重新拉取，拿到正文后再交给树。
import type { Message } from '../api/types';
import type { Streaming } from '../store/chat';

const FINAL = new Set(['saved', 'cancelled', 'error']);

export function isTurnSettled(streaming: Streaming | null, treeMessage: Pick<Message, 'content'> | undefined): boolean {
  if (!streaming || !treeMessage) return false;
  if (!FINAL.has(streaming.status)) return false;
  return treeMessage.content !== '' || streaming.text === '';
}
