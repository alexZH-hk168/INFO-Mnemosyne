// [VER1] 回归测试：回合进行中拉到的树里已有这轮的空占位回答（后端在回合开始就插入空消息）。
// 修复前：树里一出现这条消息就清掉 turn，流式正文不再显示，结束后也不刷新树，回答一直空白（真实插件冒烟发现）。
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationTree, Message } from '../api/types';
import { queryKeys } from '../api/queries';
import { useChat } from '../store/chat';
import { useLayout } from '../store/layout';
import { renderWithClient, setupF3Msw } from '../test/f3-utils';
import ChatColumn from './ChatColumn';

setupF3Msw();
vi.setConfig({ testTimeout: 20000 });

const CID = 'cnv_transformer';

function withPlaceholder(tree: ConversationTree, content: string): ConversationTree {
  const leaf = tree.active_leaf_id ?? tree.conversation.active_leaf_id;
  const user: Message = {
    id: 'msg_s_u',
    conversation_id: CID,
    parent_id: leaf,
    role: 'user',
    content: '新问题',
    created_at: '2026-11-23T08:00:00Z',
  };
  const ans: Message = {
    id: 'msg_s_a',
    conversation_id: CID,
    parent_id: 'msg_s_u',
    role: 'assistant',
    content,
    created_at: '2026-11-23T08:00:01Z',
  };
  return {
    ...tree,
    messages: [...tree.messages, user, ans],
    active_leaf_id: 'msg_s_a',
    conversation: { ...tree.conversation, active_leaf_id: 'msg_s_a' },
  };
}

describe('[VER1] 回合中途拉到的树里有空占位回答', () => {
  it('流式期间只显示一条回答且正文来自流式；结束后等树刷新到正文再交给树', async () => {
    useChat.setState({ conversationId: CID });
    useLayout.setState({ view: 'conversation' });
    const { client } = renderWithClient(<ChatColumn />);
    await screen.findByTestId('chat.assistant-message:msg_tf_a2', {}, { timeout: 5000 });
    const base = client.getQueryData<ConversationTree>(queryKeys.tree(CID))!;

    act(() => {
      useChat.setState({
        turn: {
          kind: 'send',
          conversation_id: CID,
          client_msg_id: 'c1',
          content: '新问题',
          user_message_id: 'msg_s_u',
          connection: 'live',
        },
        streaming: {
          message_id: 'msg_s_a',
          client_msg_id: 'c1',
          last_seq: 3,
          steps: [],
          evidence: [],
          text: '流式正文',
          citations: [],
          status: 'streaming',
        },
      });
      client.setQueryData(queryKeys.tree(CID), withPlaceholder(base, ''));
    });
    // turn 不能被清掉，回答只有一条（流式视图），正文是流式文字
    expect(useChat.getState().turn).not.toBeNull();
    expect(screen.getAllByTestId('chat.assistant-message:msg_s_a')).toHaveLength(1);
    expect(screen.getByTestId('chat.answer-body:msg_s_a')).toHaveTextContent('流式正文');

    // 结束了但树还是中途的空占位：仍显示流式正文，不交给树
    act(() => useChat.setState((s) => ({ streaming: { ...s.streaming!, status: 'saved', text: '流式正文完整' } })));
    // 结束时对话栏会失效 ['tree', cid]（MSW 重新拉取）；等拉取结束后再摆回“中途的空占位”
    await waitFor(() => expect(client.isFetching()).toBe(0));
    act(() => client.setQueryData(queryKeys.tree(CID), withPlaceholder(base, '')));
    expect(useChat.getState().turn).not.toBeNull();
    expect(screen.getByTestId('chat.answer-body:msg_s_a')).toHaveTextContent('流式正文完整');

    // 树刷新到入库后的正文：交给树
    act(() => client.setQueryData(queryKeys.tree(CID), withPlaceholder(base, '入库后的正文')));
    await waitFor(() => expect(useChat.getState().turn).toBeNull());
    expect(screen.getAllByTestId('chat.assistant-message:msg_s_a')).toHaveLength(1);
    expect(screen.getByTestId('chat.answer-body:msg_s_a')).toHaveTextContent('入库后的正文');
  });
});
