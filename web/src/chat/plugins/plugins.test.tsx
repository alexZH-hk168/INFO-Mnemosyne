// F6b：1-输入框-插件区入口、2-插件区-会话插件弹层、2-会话插件弹层-插件开关、2-会话插件弹层-去插件市场 的状态与交互单测。
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin, Step } from '../../api/types';
import { marketControls, marketWorldHandlers, resetMarketWorld } from '../../mocks/market-world';
import { draftKey, NEW_MAIN, useChat } from '../../store/chat';
import { useLayout } from '../../store/layout';
import { useUI } from '../../store/ui';
import { renderWithClient, seen, server, setupF3Msw } from '../../test/f3-utils';
import Composer from '../Composer';
import { buildRow, countCalls, shortName, stepMatchesPlugin } from './pluginRows';
import { commitHomePlugins, nextEnabledIds } from './usePluginToggle';

setupF3Msw();
vi.setConfig({ testTimeout: 20000 });

beforeEach(() => {
  resetMarketWorld();
  server.use(...marketWorldHandlers);
});

const CID = 'cnv_transformer';
const renderChat = () => renderWithClient(<Composer variant="chat" conversationId={CID} parentId="msg_tf_a2" />);
const entry = () => screen.getByTestId('composer.plugin-entry');
const openPopover = async () => {
  fireEvent.click(entry());
  return screen.findByTestId('plugins.popover');
};
const puts = () => seen.filter((r) => r.method === 'PUT' && r.path.endsWith('/plugins'));

describe('pluginRows 纯函数', () => {
  const arxiv = { id: 'arxiv', name: 'ArXiv MCP Server', short_name: 'arXiv' };
  it('简称缺省退回全名', () => {
    expect(shortName({ name: 'ArXiv MCP Server', short_name: 'arXiv' })).toBe('arXiv');
    expect(shortName({ name: 'Foo MCP' })).toBe('Foo MCP');
  });
  it('步骤 label 以 id__ 开头或含简称/全名时算该插件的调用；只数 plugin_tool，同一 step_id 只算一次', () => {
    expect(stepMatchesPlugin('arxiv__search_papers', arxiv)).toBe(true);
    expect(stepMatchesPlugin('arXiv：get_abstract 1706.03762', arxiv)).toBe(true);
    expect(stepMatchesPlugin('抓取网页：jalammar.github.io', arxiv)).toBe(false);
    const steps: Step[] = [
      { step_id: 's1', kind: 'plugin_tool', label: 'arXiv：search_papers', status: 'running' },
      { step_id: 's1', kind: 'plugin_tool', label: 'arXiv：search_papers', status: 'done' },
      { step_id: 's2', kind: 'plugin_tool', label: 'arxiv__get_abstract', status: 'done' },
      { step_id: 's3', kind: 'search_web', label: 'arXiv 网页', status: 'done' },
    ];
    expect(countCalls(steps, arxiv)).toBe(2);
  });
  it('步骤带 plugin_id（契约 v0.5，原 U60）时只按 plugin_id 匹配，不看 label', () => {
    const steps: Step[] = [
      { step_id: 's1', kind: 'plugin_tool', label: '检索论文', status: 'done', plugin_id: 'arxiv' },
      { step_id: 's2', kind: 'plugin_tool', label: 'arXiv 相关网页', status: 'done', plugin_id: 'fetch' },
    ];
    expect(countCalls(steps, arxiv)).toBe(1);
  });
  it('缺必填配置：不可用、开关关，副标题写“需要 API Key（未配置）”；已配置写“（已配置）”', () => {
    const tavily: InstalledPlugin = {
      id: 'tavily',
      name: 'Tavily MCP',
      version: '1.0.0',
      status: 'installed',
      permissions: ['network'],
      config_schema: { TAVILY_API_KEY: { required: true, secret: true, label: 'Tavily API Key' } },
      config_set: [],
    };
    const m = { category: '网页检索与抓取' } as never;
    const off = buildRow(tavily, undefined, true, m, 2, []);
    expect(off).toMatchObject({ usable: false, enabled: false, sub: '网页检索与抓取 · 需要 API Key（未配置）' });
    const on = buildRow({ ...tavily, config_set: ['TAVILY_API_KEY'] }, undefined, true, m, 2, []);
    expect(on).toMatchObject({ usable: true, enabled: true, sub: '网页检索与抓取 · 需要 API Key（已配置）' });
  });
  it('status=error：用会话接口的 reason', () => {
    const z: InstalledPlugin = {
      id: 'zotero',
      name: 'Zotero MCP Plugin',
      version: '1.0.0',
      status: 'error',
      permissions: [],
      config_schema: {},
    };
    const row = buildRow(
      z,
      { plugin_id: 'zotero', enabled: true, status: 'error', reason: '本机 Zotero 未连接' },
      true,
      { category: '文献管理' } as never,
      6,
      [],
    );
    expect(row).toMatchObject({ usable: false, enabled: false, sub: '文献管理 · 本机 Zotero 未连接' });
  });
  it('nextEnabledIds 只动被切换的那一项', () => {
    const list = [
      { plugin_id: 'arxiv', enabled: true, status: 'installed' as const },
      { plugin_id: 'fetch', enabled: false, status: 'installed' as const },
      { plugin_id: 'markitdown', enabled: true, status: 'installed' as const },
    ];
    expect(nextEnabledIds(list, 'arxiv', false)).toEqual(['markitdown']);
    expect(nextEnabledIds(list, 'fetch', true)).toEqual(['arxiv', 'markitdown', 'fetch']);
  });
});

describe('1-输入框-插件区入口', () => {
  it('对话里列出已启用插件的简称（契约 v0.5 short_name）', async () => {
    renderChat();
    await waitFor(() => expect(entry()).toHaveTextContent('arXiv · 网页检索 · PDF 解析'));
  });
  it('主页：托条“已启用 N 个插件”、内层“插件 · N”，读已安装插件的默认启用状态', async () => {
    renderWithClient(<Composer variant="home" />);
    await waitFor(() => expect(entry()).toHaveTextContent('已启用 3 个插件'));
    expect(screen.getByTestId('composer.plugin-entry.inline')).toHaveTextContent('插件 · 3');
  });
  it('状态：无启用插件 → 显示“插件”', async () => {
    server.use(
      http.get('*/api/conversations/:cid/plugins', () =>
        HttpResponse.json({ plugins: [{ plugin_id: 'arxiv', enabled: false, status: 'installed' }] }),
      ),
    );
    renderChat();
    await waitFor(() => expect(entry()).toHaveTextContent(/^插件$/));
  });
  it('状态：弹层打开 → 胶囊高亮（aria-expanded），再点关闭', async () => {
    renderChat();
    await openPopover();
    expect(entry()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(entry());
    expect(useUI.getState().popover).toBeNull();
    expect(screen.queryByTestId('plugins.popover')).toBeNull();
  });
});

describe('2-插件区-会话插件弹层', () => {
  it('上半列已安装插件与开关，下半只列已启用 Skill，底部“去插件市场”', async () => {
    renderChat();
    const pop = await openPopover();
    await within(pop).findByTestId('plugins.toggle:arxiv');
    expect(within(pop).getByText('本对话的插件')).toBeInTheDocument();
    for (const id of ['arxiv', 'fetch', 'markitdown'])
      expect(within(pop).getByTestId(`plugins.toggle:${id}`)).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(within(pop).getByTestId('plugins.popover.sub:arxiv')).toHaveTextContent('学术检索'));
    expect(within(pop).getByText('Skill · 输入 / 直接调用')).toBeInTheDocument();
    expect(await within(pop).findByTestId('plugins.popover.skill:pdf')).toHaveTextContent('/pdf');
    expect(within(pop).queryByTestId('plugins.popover.skill:literature-review')).toBeNull(); // 未启用
    expect(within(pop).getByTestId('plugins.go-market')).toHaveTextContent('去插件市场');
  });
  it('打开后焦点在第一个开关上；Esc 关闭且焦点回到胶囊', async () => {
    renderChat();
    entry().focus();
    const pop = await openPopover();
    await waitFor(() => expect(within(pop).getByTestId('plugins.toggle:arxiv')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useUI.getState().popover).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(entry()));
  });
  it('点外部关闭；点弹层内部不关', async () => {
    renderChat();
    const pop = await openPopover();
    fireEvent.mouseDown(pop);
    expect(useUI.getState().popover).toBe('plugins');
    fireEvent.mouseDown(document.body);
    expect(useUI.getState().popover).toBeNull();
  });
  it('状态：无已安装插件 → “还没有安装插件”', async () => {
    server.use(
      http.get('*/api/plugins', () => HttpResponse.json({ plugins: [] })),
      http.get('*/api/conversations/:cid/plugins', () => HttpResponse.json({ plugins: [] })),
    );
    renderChat();
    const pop = await openPopover();
    expect(await within(pop).findByTestId('plugins.popover.empty')).toHaveTextContent('还没有安装插件');
  });
  it('状态：status=error 或缺配置 → 开关置灰关闭、副标题写原因（UI-11 组合）', async () => {
    marketControls.seedUi11(CID);
    renderChat();
    const pop = await openPopover();
    const z = await within(pop).findByTestId('plugins.toggle:zotero');
    expect(z).toBeDisabled();
    expect(z).toHaveAttribute('aria-checked', 'false');
    await waitFor(() =>
      expect(within(pop).getByTestId('plugins.popover.sub:zotero')).toHaveTextContent('文献管理 · 本机 Zotero 未连接'),
    );
    expect(within(pop).getByTestId('plugins.popover.sub:tavily')).toHaveTextContent('需要 API Key（已配置）');
    expect(within(pop).getByTestId('plugins.toggle:tavily')).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(entry()).toHaveTextContent('arXiv · Tavily 检索 · PDF 解析'));
  });
  it('副标题带本轮调用次数（当前回答的 plugin_tool 步骤）', async () => {
    act(() =>
      useChat.setState({
        turn: {
          kind: 'send',
          conversation_id: CID,
          client_msg_id: 'c1',
          content: 'x',
          connection: 'live',
        },
        streaming: {
          message_id: 'msg_x',
          client_msg_id: 'c1',
          last_seq: 3,
          steps: [{ step_id: 'stp_1', kind: 'plugin_tool', label: 'arXiv：get_abstract 1706.03762', status: 'done' }],
          evidence: [],
          text: '',
          citations: [],
          status: 'saved',
        },
      }),
    );
    renderChat();
    const pop = await openPopover();
    await waitFor(() =>
      expect(within(pop).getByTestId('plugins.popover.sub:arxiv')).toHaveTextContent('学术检索 · 本轮调用 1 次'),
    );
    expect(within(pop).getByTestId('plugins.popover.sub:fetch')).not.toHaveTextContent('本轮调用');
  });
  it('点 Skill 行：本轮强制使用（composer.forced_skill），关闭弹层', async () => {
    renderChat();
    const pop = await openPopover();
    fireEvent.click(await within(pop).findByTestId('plugins.popover.skill:pdf'));
    expect(useChat.getState().composer[draftKey(CID)].forced_skill).toBe('pdf');
    expect(useUI.getState().popover).toBeNull();
    expect(await screen.findByTestId('composer.skill-tag')).toHaveTextContent('/pdf');
  });
  it('齿轮：打开市场“已安装”标签', async () => {
    renderChat();
    const pop = await openPopover();
    fireEvent.click(within(pop).getByTestId('plugins.popover.settings'));
    expect(useLayout.getState().view).toBe('market');
    expect(useLayout.getState().marketRoute).toEqual({ tab: 'installed' });
    expect(useUI.getState().popover).toBeNull();
  });
});

describe('2-会话插件弹层-去插件市场', () => {
  it('关闭弹层，打开市场插件标签；对话草稿保留', async () => {
    useChat.getState().setDraft(draftKey(CID), { text: '还没写完的问题' });
    renderChat();
    const pop = await openPopover();
    fireEvent.click(within(pop).getByTestId('plugins.go-market'));
    expect(useUI.getState().popover).toBeNull();
    expect(useLayout.getState().view).toBe('market');
    expect(useLayout.getState().marketRoute).toEqual({ tab: 'plugins' });
    expect(window.location.pathname).toBe('/market/plugins');
    expect(useChat.getState().composer[draftKey(CID)].text).toBe('还没写完的问题');
  });
});

describe('2-会话插件弹层-插件开关', () => {
  it('切换：PUT enabled_plugin_ids，胶囊随之更新', async () => {
    renderChat();
    const pop = await openPopover();
    const sw = await within(pop).findByTestId('plugins.toggle:arxiv');
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false')); // 乐观更新
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ enabled_plugin_ids: ['fetch', 'markitdown'] });
    await waitFor(() => expect(entry()).toHaveTextContent('网页检索 · PDF 解析'));
    expect(entry()).not.toHaveTextContent('arXiv');
  });
  it('保存失败：回滚开关并提示', async () => {
    marketControls.failConvPluginsPut(true);
    renderChat();
    const pop = await openPopover();
    const sw = await within(pop).findByTestId('plugins.toggle:fetch');
    fireEvent.click(sw);
    await waitFor(() => expect(useUI.getState().toasts.some((t) => t.text.includes('插件设置没有保存'))).toBe(true));
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
  });
  it('不可用的插件开关不可切', async () => {
    marketControls.seedUi11(CID);
    renderChat();
    const pop = await openPopover();
    const z = await within(pop).findByTestId('plugins.toggle:zotero');
    await waitFor(() => expect(z).toBeDisabled());
    fireEvent.click(z);
    expect(puts()).toHaveLength(0);
  });
  it('主页无 cid：暂存到主页草稿，托条数字随之变；建对话后 commitHomePlugins 一并提交', async () => {
    renderWithClient(<Composer variant="home" />);
    await waitFor(() => expect(entry()).toHaveTextContent('已启用 3 个插件'));
    const pop = await openPopover();
    fireEvent.click(await within(pop).findByTestId('plugins.toggle:markitdown'));
    expect(useChat.getState().composer[NEW_MAIN].enabled_plugin_ids).toEqual(['arxiv', 'fetch']);
    expect(puts()).toHaveLength(0);
    await waitFor(() => expect(entry()).toHaveTextContent('已启用 2 个插件'));
    const qc = new QueryClient();
    await commitHomePlugins(qc, 'cnv_new_x');
    expect(puts()).toHaveLength(1);
    expect(puts()[0].path).toBe('/api/conversations/cnv_new_x/plugins');
    expect(puts()[0].body).toEqual({ enabled_plugin_ids: ['arxiv', 'fetch'] });
  });
  it('主页没改过开关：建对话时不提交（新对话默认全部启用）', async () => {
    await commitHomePlugins(new QueryClient(), 'cnv_new_y');
    expect(puts()).toHaveLength(0);
  });
});
