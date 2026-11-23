// F6 设置弹窗与记忆管理的单元测试。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import FourPane from '../layout/FourPane';
import { marketControls } from '../mocks/market-world';
import { renderWithClient, server, setupMarketMsw } from '../market/test-utils';
import { useChat } from '../store/chat';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';
import { DELETE_CONFIRM_TEXT, EMPTY_TEXT } from './MemorySection';

setupMarketMsw();

async function openSettings() {
  renderWithClient(<FourPane />);
  const card = await screen.findByTestId('sidebar.user-card');
  card.focus();
  fireEvent.click(card);
  return screen.findByTestId('settings.dialog');
}

describe('2-用户卡片-设置弹窗', () => {
  it('用户卡片打开设置：左侧导航 模型 / 检索 / 记忆，默认模型页', async () => {
    const dialog = await openSettings();
    expect(useUI.getState().modal).toEqual({ kind: 'settings' });
    for (const k of ['model', 'search', 'memory'])
      expect(within(dialog).getByTestId(`settings.dialog.nav:${k}`)).toBeInTheDocument();
    expect(await screen.findByTestId('settings.dialog.model')).toBeInTheDocument();
    expect(screen.getByTestId('settings.dialog.api-base')).toHaveValue('https://api.example.com/v1');
    expect(screen.getByTestId('settings.dialog.save')).toBeDisabled();
  });

  it('保存模型页：只发改动字段；API Key 只写不读，保存后显示“已设置 · 修改”', async () => {
    let body: unknown;
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PUT' && request.url.endsWith('/api/settings')) body = await request.clone().json();
    });
    await openSettings();
    fireEvent.change(await screen.findByTestId('settings.dialog.chat-model'), { target: { value: 'my-chat' } });
    // v0.5 [BYOK]：默认样例已设置 Key，先点“修改”才出现输入框
    fireEvent.click(screen.getByTestId('settings.dialog.api-key-edit'));
    fireEvent.change(screen.getByTestId('settings.dialog.api-key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByTestId('settings.dialog.save'));
    expect(await screen.findByTestId('settings.dialog.api-key-set')).toHaveTextContent('已设置');
    expect(body).toEqual({ chat_model: 'my-chat', api_key: 'sk-test' });
    expect(screen.getByTestId('settings.dialog.chat-model')).toHaveValue('my-chat');
    fireEvent.click(screen.getByTestId('settings.dialog.api-key-edit'));
    expect(screen.getByTestId('settings.dialog.api-key')).toHaveValue('');
    server.events.removeAllListeners();
  });

  it('MODEL_UNAVAILABLE：保存后测试调用失败时在模型页顶部显示原因', async () => {
    marketControls.setModelUnavailable(true);
    await openSettings();
    fireEvent.change(await screen.findByTestId('settings.dialog.small-model'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('settings.dialog.save'));
    expect(await screen.findByTestId('settings.dialog.model-unavailable')).toHaveTextContent('Key 无效');
  });

  it('VALIDATION_ERROR：api_base 不合法时显示原因', async () => {
    await openSettings();
    fireEvent.change(await screen.findByTestId('settings.dialog.api-base'), { target: { value: 'not a url' } });
    fireEvent.click(screen.getByTestId('settings.dialog.save'));
    expect(await screen.findByTestId('settings.dialog.error')).toHaveTextContent('api_base 必须是 http(s) 地址');
  });

  it('检索页：联网检索默认值开关 + 保存', async () => {
    await openSettings();
    fireEvent.click(screen.getByTestId('settings.dialog.nav:search'));
    const sw = await screen.findByTestId('settings.dialog.web-search');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    fireEvent.click(screen.getByTestId('settings.dialog.save'));
    await waitFor(() => expect(screen.getByTestId('settings.dialog.save')).toBeDisabled());
    expect(screen.getByTestId('settings.dialog.web-search')).toHaveAttribute('aria-checked', 'true');
  });

  it('关闭 / Esc 关闭，焦点回到用户卡片', async () => {
    const dialog = await openSettings();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(useUI.getState().modal).toBeNull();
    await waitFor(() => expect(screen.getByTestId('sidebar.user-card')).toHaveFocus());
  });
});

describe('3-设置-记忆管理', () => {
  async function openMemory() {
    await openSettings();
    fireEvent.click(screen.getByTestId('settings.dialog.nav:memory'));
    return screen.findByTestId('settings.memory');
  }

  it('记忆开关、画像摘要（只读）、条目列表', async () => {
    await openMemory();
    expect(await screen.findByTestId('settings.memory.summary')).toHaveTextContent('正在学习深度学习导论');
    expect(await screen.findByTestId('settings.memory.item:mem_hw3_sigmoid')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^settings\.memory\.item:/)).toHaveLength(3);
    const sw = screen.getByTestId('settings.memory.enabled');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByTestId('settings.memory.enabled')).toHaveAttribute('aria-checked', 'false'));
  });

  it('按作用域与主题筛选', async () => {
    await openMemory();
    await screen.findByTestId('settings.memory.item:mem_hw3_sigmoid');
    fireEvent.click(screen.getByTestId('settings.memory.scope:global'));
    await waitFor(() => expect(screen.getAllByTestId(/^settings\.memory\.item:/)).toHaveLength(1));
    expect(screen.getByTestId('settings.memory.item:mem_pref_conclusion')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('settings.memory.scope:all'));
    await waitFor(() => expect(screen.getAllByTestId(/^settings\.memory\.item:/)).toHaveLength(3));
    fireEvent.click(screen.getByTestId('settings.memory.topic:反向传播'));
    expect(screen.getAllByTestId(/^settings\.memory\.item:/)).toHaveLength(1);
  });

  it('删除有二次确认，文案说明“原始对话仍保留”；确认后条目消失且刷新不再出现', async () => {
    await openMemory();
    fireEvent.click(await screen.findByTestId('settings.memory.delete:mem_pref_conclusion'));
    const confirm = await screen.findByTestId('settings.memory.confirm');
    expect(within(confirm).getByTestId('settings.memory.confirm.text')).toHaveTextContent(DELETE_CONFIRM_TEXT);
    expect(DELETE_CONFIRM_TEXT).toContain('原始对话仍保留');
    // Esc 只关确认框，不关设置
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.queryByTestId('settings.memory.confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings.dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('settings.memory.delete:mem_pref_conclusion'));
    fireEvent.click(
      within(await screen.findByTestId('settings.memory.confirm')).getByTestId('settings.memory.confirm.ok'),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('settings.memory.item:mem_pref_conclusion')).not.toBeInTheDocument(),
    );
    // 重新打开设置（重新请求）仍不出现
    fireEvent.click(screen.getByTestId('settings.dialog.close'));
    act(() => useUI.getState().openModal('settings', { section: 'memory' }));
    await screen.findByTestId('settings.memory.item:mem_hw3_sigmoid');
    expect(screen.queryByTestId('settings.memory.item:mem_pref_conclusion')).not.toBeInTheDocument();
  });

  it('编辑条目：行内编辑后保存（PUT /api/memory/items/{id}）', async () => {
    await openMemory();
    fireEvent.click(await screen.findByTestId('settings.memory.edit:mem_hw3_sigmoid'));
    const input = screen.getByTestId('settings.memory.input:mem_hw3_sigmoid');
    fireEvent.change(input, { target: { value: '已改用 ReLU 解决' } });
    fireEvent.click(screen.getByTestId('settings.memory.save:mem_hw3_sigmoid'));
    await waitFor(() =>
      expect(screen.getByTestId('settings.memory.item:mem_hw3_sigmoid')).toHaveTextContent('已改用 ReLU 解决'),
    );
  });

  it('superseded 默认隐藏，勾选“显示历史版本”后删除线显示并带有效期', async () => {
    await openMemory();
    await screen.findByTestId('settings.memory.item:mem_hw3_sigmoid');
    expect(screen.queryByTestId('settings.memory.item:mem_hw3_sigmoid_v1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('settings.memory.show-history'));
    const old = await screen.findByTestId('settings.memory.item:mem_hw3_sigmoid_v1');
    expect(old).toHaveAttribute('data-status', 'superseded');
    expect(old.querySelector('p')).toHaveClass('line-through');
    expect(screen.getByTestId('settings.memory.validity:mem_hw3_sigmoid_v1')).toHaveTextContent(
      '2026-11-20 – 2026-11-21',
    );
    expect(screen.queryByTestId('settings.memory.delete:mem_hw3_sigmoid_v1')).not.toBeInTheDocument();
  });

  it('无条目：“还没有记忆。多聊几轮后……”', async () => {
    server.use(http.get('*/api/memory/items', () => HttpResponse.json({ items: [] })));
    await openMemory();
    expect(await screen.findByTestId('settings.memory.empty')).toHaveTextContent(EMPTY_TEXT);
  });

  it('查看来源：有 source_conversation_id 时关闭设置、跳到该对话，并在右栏打开原消息', async () => {
    await openMemory();
    fireEvent.click(await screen.findByTestId('settings.memory.source:mem_hw3_sigmoid'));
    expect(useUI.getState().modal).toBeNull();
    expect(useChat.getState().conversationId).toBe('cnv_backprop_hw3');
    expect(useLayout.getState().view).toBe('conversation');
    expect(window.location.pathname).toBe('/c/cnv_backprop_hw3');
    expect(useLayout.getState().rightTabs.at(-1)).toMatchObject({ kind: 'message', ref_id: 'msg_hw3_a2' });
  });

  it('查看来源：没有 source_conversation_id 时只在右栏打开原消息', async () => {
    server.use(
      http.get('*/api/memory/items', ({ request }) =>
        new URL(request.url).searchParams.get('status') === 'superseded'
          ? HttpResponse.json({ items: [] })
          : HttpResponse.json({
              items: [
                {
                  id: 'mem_x',
                  scope: 'global',
                  topic: 't',
                  content: 'c',
                  source_message_ids: ['msg_tf_u1'],
                  status: 'active',
                  confidence: 0.5,
                },
              ],
            }),
      ),
    );
    const before = window.location.pathname;
    await openMemory();
    fireEvent.click(await screen.findByTestId('settings.memory.source:mem_x'));
    expect(useUI.getState().modal).toBeNull();
    expect(window.location.pathname).toBe(before);
    expect(useLayout.getState().rightTabs.at(-1)).toMatchObject({ kind: 'message', ref_id: 'msg_tf_u1' });
  });
});

describe('3-设置-模型（v0.5 [BYOK]）', () => {
  it('已配置：顶部显示“正在使用你自己的模型”，Key 显示末 4 位掩码，输入框是 password', async () => {
    await openSettings();
    expect(await screen.findByTestId('settings.model.mode')).toHaveAttribute('data-mode', 'real');
    expect(screen.getByTestId('settings.model.api-key-hint')).toHaveTextContent('••••a1b2');
    fireEvent.click(screen.getByTestId('settings.dialog.api-key-edit'));
    expect(screen.getByTestId('settings.dialog.api-key')).toHaveAttribute('type', 'password');
  });

  it('选服务商预设：自动填 API 地址与推荐模型名，保存时带 provider', async () => {
    let body: unknown;
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PUT' && request.url.endsWith('/api/settings')) body = await request.clone().json();
    });
    await openSettings();
    const sel = await screen.findByTestId('settings.model.provider');
    await waitFor(() => expect(within(sel).getAllByRole('option')).toHaveLength(4));
    fireEvent.change(sel, { target: { value: 'deepseek' } });
    expect(screen.getByTestId('settings.dialog.api-base')).toHaveValue('https://api.deepseek.com');
    expect(screen.getByTestId('settings.dialog.chat-model')).toHaveValue('deepseek-v4-pro');
    expect(screen.getByTestId('settings.dialog.small-model')).toHaveValue('deepseek-flash');
    expect(screen.getByTestId('settings.dialog.embedding-model')).toHaveValue('');
    expect(screen.getByTestId('settings.model.provider-notes')).toHaveTextContent('没有嵌入接口');
    expect(screen.getByTestId('settings.model.retrieval-hint')).toHaveTextContent('本地 BM25');
    fireEvent.click(screen.getByTestId('settings.dialog.save'));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      api_base: 'https://api.deepseek.com',
      chat_model: 'deepseek-v4-pro',
      small_model: 'deepseek-flash',
      embedding_model: '',
      provider: 'deepseek',
    });
    server.events.removeAllListeners();
  });

  it('测试连接：发当前填写值（不回传已存 Key），显示成功与工具调用支持', async () => {
    let body: unknown;
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/api/settings/test')) body = await request.clone().json();
    });
    await openSettings();
    fireEvent.change(await screen.findByTestId('settings.dialog.chat-model'), { target: { value: 'my-chat' } });
    fireEvent.click(screen.getByTestId('settings.model.test'));
    const res = await screen.findByTestId('settings.model.test-result');
    expect(res).toHaveAttribute('data-ok', 'true');
    expect(res).toHaveTextContent('连接成功');
    expect(res).toHaveTextContent('支持工具调用');
    expect(body).toMatchObject({ chat_model: 'my-chat', api_base: 'https://api.example.com/v1' });
    expect(body).not.toHaveProperty('api_key');
    server.events.removeAllListeners();
  });

  it('测试连接失败：显示中文原因', async () => {
    marketControls.setTestResult('key-invalid');
    await openSettings();
    fireEvent.click(await screen.findByTestId('settings.model.test'));
    const res = await screen.findByTestId('settings.model.test-result');
    expect(res).toHaveAttribute('data-ok', 'false');
    expect(res).toHaveTextContent('密钥无效');
  });

  it('清除 Key：保存发 api_key 空串，之后回到演示模式', async () => {
    let body: unknown;
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'PUT' && request.url.endsWith('/api/settings')) body = await request.clone().json();
    });
    await openSettings();
    fireEvent.click(await screen.findByTestId('settings.model.api-key-clear'));
    expect(screen.getByTestId('settings.dialog.api-key')).toHaveAttribute('placeholder', '保存后清除已存的 Key');
    fireEvent.click(screen.getByTestId('settings.dialog.save'));
    await waitFor(() => expect(screen.getByTestId('settings.model.mode')).toHaveAttribute('data-mode', 'demo'));
    expect(body).toEqual({ api_key: '' });
    expect(screen.getByTestId('settings.dialog.api-key')).toHaveValue('');
    server.events.removeAllListeners();
  });

  it('演示模式：未配置时测试连接按钮禁用，顶部写“回答由本地示例生成”', async () => {
    marketControls.setDemoMode();
    await openSettings();
    expect(await screen.findByTestId('settings.model.mode')).toHaveTextContent('回答由本地示例生成');
    expect(screen.getByTestId('settings.model.test')).toBeDisabled();
    expect(screen.getByTestId('settings.dialog.api-key')).toHaveAttribute('type', 'password');
  });
});
