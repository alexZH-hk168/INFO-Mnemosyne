// F3：输入框各规格的状态与交互（1-外壳-输入框、发送停止、联网检索、引用范围、附件、模型档位、@ 引用、/ Skill）。
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { DocumentGroups } from '../api/endpoints';
import type { Document, Project, SendMessageBody } from '../api/types';
import { DOC_DRAG_TYPE } from '../files/FileRow';
import { fixtures } from '../mocks/handlers';
import type { RestFixture } from '../mocks/fixture-types';
import { draftKey, NEW_MAIN, useChat } from '../store/chat';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';
import { renderWithClient, seen, server, setupF3Msw } from '../test/f3-utils';
import Composer, { PLACEHOLDER } from './Composer';
import { requestComposerFocus } from './focus';

setupF3Msw();
/** 对话 cnv_transformer 的主线草稿 key（U37） */
const K = draftKey('cnv_transformer');

const textbox = (root: HTMLElement = document.body) => within(root).getByRole('textbox') as HTMLTextAreaElement;
const sendBtn = () => screen.getByTestId('composer.send');
const posts = () => seen.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'));
const type = (el: HTMLTextAreaElement, value: string) => {
  fireEvent.change(el, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
  el.setSelectionRange(value.length, value.length);
};
const renderChat = () =>
  renderWithClient(<Composer variant="chat" conversationId="cnv_transformer" parentId="msg_tf_a2" />);
/** 等文件与设置加载完 */
const ready = async () => {
  await waitFor(() => expect(screen.getByTestId('composer.scope')).toHaveTextContent('全部材料'));
  await waitFor(() => expect(screen.getByTestId('composer.model')).toHaveTextContent('模型 · 高'));
};

describe('1-外壳-输入框', () => {
  it('三种 variant 的占位文案与外层托条', () => {
    const { unmount } = renderWithClient(<Composer variant="home" />);
    expect(textbox()).toHaveAttribute('placeholder', PLACEHOLDER.home);
    expect(screen.getByTestId('composer.box')).toHaveAttribute('data-variant', 'home');
    expect(screen.getByTestId('composer.bar')).toBeInTheDocument();
    unmount();
    renderChat().unmount();
    renderWithClient(<Composer variant="branch" conversationId="cnv_transformer" branchId="br_variance" />);
    expect(textbox()).toHaveAttribute('placeholder', PLACEHOLDER.branch);
    expect(screen.queryByTestId('composer.bar')).toBeNull();
  });

  it('空：发送键置灰；有字：可发送', async () => {
    renderChat();
    expect(sendBtn()).toBeDisabled();
    expect(sendBtn()).toHaveAttribute('data-state', 'disabled');
    type(textbox(), '你好');
    expect(sendBtn()).toBeEnabled();
    expect(sendBtn()).toHaveAttribute('data-state', 'ready');
  });

  it('Enter 发送、Shift+Enter 不发送、输入法组字中不发送', async () => {
    renderChat();
    await ready();
    const ta = textbox();
    type(ta, '第一行');
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(ta, { key: 'Enter', isComposing: true });
    expect(useChat.getState().turn).toBeNull();
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(useChat.getState().turn).toMatchObject({ content: '第一行', parent_id: 'msg_tf_a2' });
    // 发送后清空草稿
    expect(useChat.getState().composer[K].text).toBe('');
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it('生成中：发送键变停止键（aria-label“停止生成”），可继续输入但不能发送；verifying 时仍是停止', async () => {
    useChat.setState({
      turn: { kind: 'send', conversation_id: 'cnv_transformer', client_msg_id: 'x', content: 'q', connection: 'live' },
      streaming: {
        message_id: 'msg_x',
        client_msg_id: 'x',
        last_seq: 3,
        steps: [],
        evidence: [],
        text: '',
        citations: [],
        status: 'streaming',
      },
    });
    renderChat();
    expect(sendBtn()).toHaveAttribute('aria-label', '停止生成');
    expect(sendBtn()).toHaveAttribute('data-state', 'stop');
    type(textbox(), '下一问');
    expect(textbox().value).toBe('下一问');
    fireEvent.keyDown(textbox(), { key: 'Enter' });
    expect(useChat.getState().composer[K].text).toBe('下一问');
    act(() => useChat.setState((s) => ({ streaming: { ...s.streaming!, status: 'verifying' } })));
    expect(sendBtn()).toHaveAttribute('aria-label', '停止生成');
    fireEvent.click(sendBtn());
    await waitFor(() => expect(seen.some((r) => r.path === '/api/messages/msg_x/cancel')).toBe(true));
  });

  it('拖入悬停：整个输入框高亮描边；拖入文件行 = 加入 @ 引用（U23）', async () => {
    renderChat();
    await ready();
    const box = screen.getByTestId('composer.box');
    const dt = {
      types: [DOC_DRAG_TYPE, 'text/plain'],
      getData: (t: string) => (t === DOC_DRAG_TYPE ? 'doc_attention' : ''),
      files: [],
      dropEffect: 'none',
    };
    fireEvent.dragOver(box, { dataTransfer: dt });
    expect(box).toHaveAttribute('data-drag', 'true');
    fireEvent.drop(box, { dataTransfer: dt });
    expect(box).not.toHaveAttribute('data-drag');
    expect(useChat.getState().composer[K]).toMatchObject({
      text: '@Attention Is All You Need ',
      scope: { mode: 'selected', document_ids: ['doc_attention'] },
    });
  });

  it('主线与分支草稿互不覆盖（分支用 mock 分支 id）', async () => {
    renderWithClient(
      <>
        <div data-testid="main">
          <Composer variant="chat" conversationId="cnv_transformer" />
        </div>
        <div data-testid="branch">
          <Composer variant="branch" conversationId="cnv_transformer" branchId="br_mock" />
        </div>
      </>,
    );
    type(textbox(screen.getByTestId('main')), '主线草稿');
    type(textbox(screen.getByTestId('branch')), '分支草稿');
    expect(useChat.getState().composer[K].text).toBe('主线草稿');
    expect(useChat.getState().composer.br_mock.text).toBe('分支草稿');
    expect(textbox(screen.getByTestId('main')).value).toBe('主线草稿');
    expect(textbox(screen.getByTestId('branch')).value).toBe('分支草稿');
  });

  it('A 对话的草稿切到 B 不跟随，切回 A 还在（U37：主线草稿按对话存）', async () => {
    const { rerender: raw, client } = renderWithClient(<Composer variant="chat" conversationId="cnv_a" />);
    const rerender = (ui: ReactElement) => raw(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
    type(textbox(), 'A 写了一半');
    expect(useChat.getState().composer[draftKey('cnv_a')].text).toBe('A 写了一半');
    rerender(<Composer variant="chat" conversationId="cnv_b" />);
    expect(textbox().value).toBe('');
    type(textbox(), 'B 的问题');
    rerender(<Composer variant="chat" conversationId="cnv_a" />);
    expect(textbox().value).toBe('A 写了一半');
    expect(useChat.getState().composer[draftKey('cnv_b')].text).toBe('B 的问题');
    // 主页（还没有对话）是另一份
    rerender(<Composer variant="home" />);
    expect(textbox().value).toBe('');
  });

  it('分支 variant 发送带 branch_id 与 parent_id', async () => {
    renderWithClient(
      <Composer variant="branch" conversationId="cnv_transformer" branchId="br_variance" parentId="msg_bv_a2" />,
    );
    type(textbox(), '分支追问');
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].body).toMatchObject({ branch_id: 'br_variance', parent_id: 'msg_bv_a2', content: '分支追问' });
  });

  it('请求聚焦（新建对话后，U23）', async () => {
    renderWithClient(<Composer variant="home" />);
    expect(document.activeElement).not.toBe(textbox());
    requestComposerFocus('home');
    await waitFor(() => expect(document.activeElement).toBe(textbox()));
  });
});

describe('1-输入框-发送停止按钮（主页）', () => {
  it('主页发送：先建对话，再发消息，中间区切到对话栏', async () => {
    renderWithClient(<Composer variant="home" />);
    type(textbox(), '从主页问');
    fireEvent.click(sendBtn());
    await waitFor(() => expect(useLayout.getState().view).toBe('conversation'));
    const cid = useChat.getState().conversationId!;
    expect(cid).toMatch(/^cnv_new/);
    expect(seen.find((r) => r.method === 'POST' && r.path === '/api/projects/prj_dlintro/conversations')).toBeTruthy();
    await waitFor(() => expect(posts()[0]?.path).toBe(`/api/conversations/${cid}/messages`));
    expect(window.location.pathname).toBe(`/c/${cid}`);
    expect((posts()[0].body as SendMessageBody).content).toBe('从主页问');
    // U37：主页草稿 new:main 发出首条后丢弃；新对话的主线草稿是空的
    expect(useChat.getState().composer[NEW_MAIN]).toBeUndefined();
    expect(useChat.getState().composer[draftKey(cid)]).toMatchObject({ text: '', attachments: [] });
  });
});

describe('1-输入框-联网检索开关', () => {
  it('初值取 settings.web_search_default；关闭时请求体 web_search=false', async () => {
    useChat.getState().setDraft(K, { web_search: true });
    renderChat();
    await ready();
    const t = screen.getByTestId('composer.web-toggle');
    // fixture 的默认值为 false
    await waitFor(() => expect(t).toHaveAttribute('aria-pressed', 'false'));
    fireEvent.click(t);
    expect(t).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(t);
    expect(t).toHaveAttribute('aria-pressed', 'false');
    type(textbox(), 'q');
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0].body as SendMessageBody).web_search).toBe(false);
  });
});

describe('1-输入框-引用范围', () => {
  it('三选一；选择后发送的 scope 与显示一致', async () => {
    renderChat();
    await ready();
    const btn = screen.getByTestId('composer.scope');
    fireEvent.click(btn);
    expect(useUI.getState().popover).toBe('scope');
    fireEvent.click(screen.getByTestId('composer.scope.option:none'));
    expect(btn).toHaveTextContent('不用材料');
    expect(useUI.getState().popover).toBeNull();
    type(textbox(), 'q');
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0].body as SendMessageBody).scope).toEqual({ mode: 'none' });
  });

  it('选“只用已选文件”打开 @ 列表；已选时显示“已选 N 个文件”，悬停列出文件名', async () => {
    renderChat();
    await ready();
    fireEvent.click(screen.getByTestId('composer.scope'));
    fireEvent.click(screen.getByTestId('composer.scope.option:selected'));
    await waitFor(() => expect(screen.getByTestId('composer.mention')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('composer.mention.item:doc_attention'));
    const btn = screen.getByTestId('composer.scope');
    expect(btn).toHaveTextContent('已选 1 个文件');
    expect(btn).toHaveAttribute('title', 'Attention Is All You Need');
  });

  it('项目无材料：胶囊置灰、固定“不用材料”', async () => {
    const p = await api.post<Project>('/api/projects', { name: '空项目' });
    useChat.setState({ projectId: p.id });
    renderChat();
    await waitFor(() => expect(screen.getByTestId('composer.scope')).toBeDisabled());
    expect(screen.getByTestId('composer.scope')).toHaveTextContent('不用材料');
  });
});

describe('2-艾特-文件引用列表', () => {
  it('键入 @ 只列 ready 的材料；选两个文件后请求体 document_ids 长度为 2；Esc 关闭', async () => {
    renderChat();
    await ready();
    const ta = textbox();
    type(ta, '比较 @');
    const menu = await screen.findByTestId('composer.mention');
    expect(within(menu).queryByTestId('composer.mention.item:doc_longmemeval')).toBeNull(); // 解析中
    expect(within(menu).queryByTestId('composer.mention.item:doc_web_illustrated')).toBeNull(); // 网页快照
    fireEvent.keyDown(ta, { key: 'Enter' }); // 选中第一项
    expect(useChat.getState().composer[K].text).toBe('比较 @Attention Is All You Need ');
    type(ta, `${useChat.getState().composer[K].text}和 @L05`);
    await screen.findByTestId('composer.mention.item:doc_l05_attention');
    fireEvent.click(screen.getByTestId('composer.mention.item:doc_l05_attention'));
    expect(useChat.getState().composer[K].scope).toEqual({
      mode: 'selected',
      document_ids: ['doc_attention', 'doc_l05_attention'],
    });
    type(ta, `${useChat.getState().composer[K].text}@`);
    await screen.findByTestId('composer.mention');
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByTestId('composer.mention')).toBeNull();
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0].body as SendMessageBody).scope.document_ids).toHaveLength(2);
  });

  it('选中后光标在同一次提交里放到标签后面，不等下一帧（INTEG2 回归：推迟恢复会把光标拉回、收起列表）', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    renderChat();
    await ready();
    const ta = textbox();
    type(ta, '比较 @');
    await screen.findByTestId('composer.mention');
    raf.mockClear();
    fireEvent.keyDown(ta, { key: 'Enter' });
    const text = useChat.getState().composer[K].text;
    expect(text).toBe('比较 @Attention Is All You Need ');
    expect(ta.value).toBe(text);
    expect(ta.selectionStart).toBe(text.length);
    expect(document.activeElement).toBe(ta);
    expect(raf).not.toHaveBeenCalled();
    // 接着输入第二个 @：列表照常打开，不会被旧光标位置收起
    type(ta, `${text}和 @L05`);
    fireEvent.select(ta);
    expect(await screen.findByTestId('composer.mention.item:doc_l05_attention')).toBeInTheDocument();
    raf.mockRestore();
  });

  it('退格整块删除 @ 标签；删掉最后一个后 scope 回到 all', async () => {
    renderChat();
    await ready();
    const ta = textbox();
    type(ta, '@');
    await screen.findByTestId('composer.mention');
    fireEvent.click(screen.getByTestId('composer.mention.item:doc_attention'));
    const text = useChat.getState().composer[K].text;
    ta.setSelectionRange(text.length, text.length);
    fireEvent.keyDown(ta, { key: 'Backspace' });
    expect(useChat.getState().composer[K].text).toBe('');
    expect(useChat.getState().composer[K].scope).toEqual({ mode: 'all' });
  });

  it('无材料：“项目里还没有文件”', async () => {
    const p = await api.post<Project>('/api/projects', { name: '空项目' });
    useChat.setState({ projectId: p.id });
    renderChat();
    await waitFor(() => expect(screen.getByTestId('composer.scope')).toBeDisabled());
    type(textbox(), '@');
    expect(await screen.findByTestId('composer.mention')).toHaveTextContent('项目里还没有文件');
  });
});

describe('2-斜杠-Skill选择列表', () => {
  it('行首 / 列出已启用 Skill；选中后变成不可拆的标签并写入 forced_skill；退格删除', async () => {
    renderChat();
    await ready();
    const ta = textbox();
    type(ta, '/');
    const menu = await screen.findByTestId('composer.slash');
    await within(menu).findByTestId('composer.slash.item:pdf');
    expect(within(menu).queryByTestId('composer.slash.item:literature-review')).toBeNull(); // 未启用
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(useChat.getState().composer[K]).toMatchObject({ text: '', forced_skill: 'pdf' });
    expect(screen.getByTestId('composer.skill-tag')).toHaveTextContent('/pdf');
    ta.setSelectionRange(0, 0);
    fireEvent.keyDown(ta, { key: 'Backspace' });
    expect(useChat.getState().composer[K].forced_skill).toBeUndefined();
  });

  it('按前缀过滤；无匹配显示“没有匹配的 Skill · 去 Skill 市场”', async () => {
    renderChat();
    await ready();
    type(textbox(), '/zzz');
    const menu = await screen.findByTestId('composer.slash');
    expect(menu).toHaveTextContent('没有匹配的 Skill · 去 Skill 市场');
    fireEvent.click(screen.getByTestId('composer.slash.market'));
    expect(useLayout.getState().view).toBe('market');
    expect(useLayout.getState().marketRoute.tab).toBe('skills');
  });
});

describe('1-输入框-模型档位', () => {
  it('切到“快”后发送请求带 X-Model-Tier: fast', async () => {
    renderChat();
    await ready();
    fireEvent.click(screen.getByTestId('composer.model'));
    fireEvent.click(screen.getByTestId('composer.model.option:fast'));
    expect(screen.getByTestId('composer.model')).toHaveTextContent('模型 · 快');
    type(textbox(), 'q');
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].headers['x-model-tier']).toBe('fast');
    // 恢复默认，避免影响其他用例
    fireEvent.click(screen.getByTestId('composer.model'));
    fireEvent.click(screen.getByTestId('composer.model.option:high'));
  });

  it('未配置模型：显示“未配置模型”，点击打开设置', async () => {
    const body = (fixtures['get-settings.ok.json'] as RestFixture).body as object;
    server.use(http.get('*/api/settings', () => HttpResponse.json({ ...body, chat_model: '' })));
    renderChat();
    await waitFor(() => expect(screen.getByTestId('composer.model')).toHaveTextContent('未配置模型'));
    fireEvent.click(screen.getByTestId('composer.model'));
    expect(useUI.getState().modal?.kind).toBe('settings');
  });
});

describe('1-输入框-附件按钮', () => {
  it('选 PPTX：上传到当前项目，附件小卡出现并显示解析进度，加入本轮引用范围；发送时提示还在解析', async () => {
    // jsdom 里上传体无法还原成文件：上传接口用契约样例应答，文件列表里补上这份解析中的文档（真实上传在 e2e 里测）
    const up = (fixtures['post-projects-pid-documents.ok.json'] as RestFixture).body as { documents: Document[] };
    const doc = { ...up.documents[0], parse_status: 'parsing' as const, progress: 40 };
    const list = (fixtures['get-projects-pid-documents.ok.json'] as RestFixture).body as DocumentGroups;
    let uploaded = false;
    server.use(
      http.post('*/api/projects/:pid/documents', () => {
        uploaded = true;
        return HttpResponse.json(up);
      }),
      http.get('*/api/projects/:pid/documents', () =>
        HttpResponse.json(
          uploaded
            ? {
                groups: list.groups.map((g) => (g.group === 'slides' ? { ...g, documents: [...g.documents, doc] } : g)),
              }
            : list,
        ),
      ),
    );
    renderChat();
    await ready();
    const input = screen.getByTestId('composer.attach-input') as HTMLInputElement;
    const file = new File([new Uint8Array(1000)], 'L06 位置编码.pptx');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(useChat.getState().composer[K].attachments).toEqual([doc.id]));
    expect(useChat.getState().composer[K].scope).toEqual({ mode: 'selected', document_ids: [doc.id] });
    const card = await screen.findByTestId(`composer.attach-card:${doc.id}`);
    await waitFor(() => expect(card).toHaveTextContent('L06 位置编码.pptx'));
    expect(card).toHaveTextContent('解析 40%');
    expect(seen.some((r) => r.method === 'POST' && r.path === '/api/projects/prj_dlintro/documents')).toBe(true);
    type(textbox(), 'q');
    fireEvent.click(sendBtn());
    await waitFor(() => expect(useUI.getState().toasts.some((t) => t.text.includes('还在解析'))).toBe(true));
    expect(useChat.getState().composer[K].attachments).toHaveLength(0);
  });

  it('不支持的类型：提示且不上传', async () => {
    renderChat();
    await ready();
    const input = screen.getByTestId('composer.attach-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.exe')] } });
    expect(useUI.getState().toasts.some((t) => t.text.includes('不支持的文件类型'))).toBe(true);
    expect(seen.some((r) => r.path.endsWith('/documents') && r.method === 'POST')).toBe(false);
  });

  it('× 移除附件后 scope 回到 all', async () => {
    useChat.getState().setDraft(K, {
      attachments: ['doc_attention'],
      scope: { mode: 'selected', document_ids: ['doc_attention'] },
    });
    renderChat();
    await ready().catch(() => undefined);
    fireEvent.click(await screen.findByTestId('composer.attach-remove:doc_attention'));
    expect(useChat.getState().composer[K]).toMatchObject({ attachments: [], scope: { mode: 'all' } });
  });
});

describe('1-输入框-插件区入口（F6 挂载点）', () => {
  it('列出本对话启用的插件；点击打开会话插件弹层（popover=plugins），胶囊高亮', async () => {
    renderChat();
    const entry = screen.getByTestId('composer.plugin-entry');
    await waitFor(() => expect(entry).toHaveTextContent('arXiv · 网页检索 · PDF 解析') /* F6b：改用简称（原 U36） */);
    fireEvent.click(entry);
    expect(useUI.getState().popover).toBe('plugins');
    expect(entry).toHaveAttribute('aria-expanded', 'true');
  });
});

vi.setConfig({ testTimeout: 20000 });
