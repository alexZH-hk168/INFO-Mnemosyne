// F1 项目栏单元测试：1-外壳-项目栏、1-项目栏-新建对话按钮、1-项目栏-插件与Skill入口、1-项目栏-新建项目按钮、
// 2-新建项目-新建项目弹窗、1-项目栏-项目行、1-项目行-对话行、1-项目行-加载更多、1-项目栏-用户卡片
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FourPane from '../layout/FourPane';
import { relativeDay } from '../lib/time';
import { setMockScenario } from '../mocks/handlers';
import { useChat } from '../store/chat';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';
import { renderWithClient, server, setupMsw } from '../test/f1-utils';
import { SIDEBAR_KEY } from './expanded';

setupMsw();

async function renderShell() {
  const r = renderWithClient(<FourPane />);
  await screen.findByTestId('sidebar.conversation-row:cnv_transformer');
  return r;
}

describe('1-外壳-项目栏', () => {
  it('品牌行、插件与 Skill、项目树、用户卡片；没有“搜索”“长期记忆”入口', async () => {
    await renderShell();
    const panel = screen.getByTestId('sidebar.panel');
    expect(within(panel).getByText('Mnemosyne')).toHaveClass('font-serif');
    expect(within(panel).getByTestId('sidebar.new-chat')).toBeInTheDocument();
    expect(within(panel).getByTestId('shell.collapse-button:0')).toBeInTheDocument();
    expect(within(panel).getByTestId('sidebar.market-entry')).toBeInTheDocument();
    expect(within(panel).getByTestId('sidebar.new-project')).toBeInTheDocument();
    expect(within(panel).getByTestId('sidebar.user-card')).toBeInTheDocument();
    expect(within(panel).getAllByTestId(/^sidebar\.project-row:/)).toHaveLength(5);
    expect(panel).not.toHaveTextContent('搜索');
    expect(panel).not.toHaveTextContent('长期记忆');
  });

  it('加载中 3 行骨架；请求失败显示“加载失败 · 重试”，点重试恢复', async () => {
    setMockScenario('GET /api/projects', 'error');
    renderWithClient(<FourPane />);
    expect(screen.getByTestId('sidebar.project-tree.loading').children).toHaveLength(3);
    const retry = await screen.findByTestId('sidebar.project-tree.retry');
    setMockScenario('GET /api/projects', 'ok');
    fireEvent.click(retry);
    expect(await screen.findByTestId('sidebar.project-row:prj_dlintro')).toBeInTheDocument();
  });
});

describe('1-项目栏-新建对话按钮', () => {
  it('点击回到主页、清空当前对话、URL 为 /', async () => {
    window.history.replaceState(null, '', '/c/cnv_transformer');
    await renderShell();
    expect(useLayout.getState().view).toBe('conversation');
    fireEvent.click(screen.getByTestId('sidebar.new-chat'));
    expect(window.location.pathname).toBe('/');
    expect(useLayout.getState().view).toBe('home');
    expect(useChat.getState().conversationId).toBeNull();
  });
});

describe('1-项目栏-插件与Skill入口', () => {
  it('数字 = 已安装插件 3 + 已启用 Skill 1；点击进入市场页插件标签并高亮', async () => {
    await renderShell();
    const entry = screen.getByTestId('sidebar.market-entry');
    await waitFor(() => expect(within(entry).getByTestId('sidebar.market-entry.count')).toHaveTextContent('4'));
    fireEvent.click(entry);
    expect(useLayout.getState()).toMatchObject({ view: 'market', marketRoute: { tab: 'plugins' } });
    expect(window.location.pathname).toBe('/market/plugins');
    expect(entry).toHaveAttribute('aria-current', 'page');
    expect(entry).toHaveClass('bg-sel');
  });

  it('数量为 0 不显示数字；失效 query 后即时更新', async () => {
    const { client } = await renderShell();
    await screen.findByTestId('sidebar.market-entry.count');
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.get('*/api/plugins', () => HttpResponse.json({ plugins: [] })),
      http.get('*/api/skills', () => HttpResponse.json({ skills: [] })),
    );
    await act(() => client.invalidateQueries({ queryKey: ['plugins'] }));
    await act(() => client.invalidateQueries({ queryKey: ['skills'] }));
    await waitFor(() => expect(screen.queryByTestId('sidebar.market-entry.count')).not.toBeInTheDocument());
  });
});

describe('1-项目栏-新建项目按钮 / 2-新建项目-新建项目弹窗', () => {
  it('点 + 打开弹窗并聚焦输入框；空名称时创建置灰', async () => {
    await renderShell();
    const plus = screen.getByTestId('sidebar.new-project');
    expect(plus).toHaveAccessibleName('新建项目');
    plus.focus();
    fireEvent.click(plus);
    expect(useUI.getState().modal).toEqual({ kind: 'new-project' });
    const input = await screen.findByTestId('sidebar.new-project-dialog.input');
    expect(input).toHaveFocus();
    expect(screen.getByTestId('sidebar.new-project-dialog.submit')).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByTestId('sidebar.new-project-dialog.submit')).toBeDisabled();
  });

  it('回车创建：去掉前后空格，新项目出现在项目树顶部并展开，进入其主页', async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId('sidebar.new-project'));
    const input = await screen.findByTestId('sidebar.new-project-dialog.input');
    fireEvent.change(input, { target: { value: '  强化学习  ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.queryByTestId('sidebar.new-project-dialog')).not.toBeInTheDocument());
    const rows = screen.getAllByTestId(/^sidebar\.project-row:/);
    expect(rows[0]).toHaveTextContent('强化学习');
    expect(rows[0]).toHaveAttribute('aria-expanded', 'true');
    expect(useChat.getState().projectId).toBe(rows[0].getAttribute('data-testid')!.split(':')[1]);
    expect(useLayout.getState().view).toBe('home');
  });

  it('失败时输入框下红字错误，保留输入', async () => {
    await renderShell();
    setMockScenario('POST /api/projects', 'error');
    fireEvent.click(screen.getByTestId('sidebar.new-project'));
    const input = await screen.findByTestId('sidebar.new-project-dialog.input');
    fireEvent.change(input, { target: { value: '会被拒绝' } });
    fireEvent.click(screen.getByTestId('sidebar.new-project-dialog.submit'));
    expect(await screen.findByTestId('sidebar.new-project-dialog.error')).toHaveTextContent('项目名需为 1–60 个字');
    expect(input).toHaveValue('会被拒绝');
  });

  it('超过 60 字时提示且不能提交', async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId('sidebar.new-project'));
    const input = await screen.findByTestId('sidebar.new-project-dialog.input');
    fireEvent.change(input, { target: { value: '长'.repeat(61) } });
    expect(screen.getByTestId('sidebar.new-project-dialog.error')).toHaveTextContent('最多 60 个字');
    expect(screen.getByTestId('sidebar.new-project-dialog.submit')).toBeDisabled();
  });

  it('取消 / Esc / 点遮罩关闭，关闭后焦点回到 +', async () => {
    await renderShell();
    const plus = screen.getByTestId('sidebar.new-project');
    for (const close of ['cancel', 'esc', 'scrim'] as const) {
      plus.focus();
      fireEvent.click(plus);
      const dialog = await screen.findByTestId('sidebar.new-project-dialog');
      if (close === 'cancel') fireEvent.click(screen.getByTestId('sidebar.new-project-dialog.cancel'));
      if (close === 'esc') fireEvent.keyDown(dialog, { key: 'Escape' });
      if (close === 'scrim') fireEvent.mouseDown(screen.getByTestId('sidebar.new-project-dialog.scrim'));
      await waitFor(() => expect(screen.queryByTestId('sidebar.new-project-dialog')).not.toBeInTheDocument());
      expect(plus).toHaveFocus();
    }
  });

  it('Tab 在弹窗内循环（锁焦点）', async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId('sidebar.new-project'));
    const input = await screen.findByTestId('sidebar.new-project-dialog.input');
    fireEvent.change(input, { target: { value: 'x' } });
    const submit = screen.getByTestId('sidebar.new-project-dialog.submit');
    submit.focus();
    fireEvent.keyDown(submit, { key: 'Tab' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(submit).toHaveFocus();
  });
});

describe('1-项目栏-项目行', () => {
  it('当前项目打开的文件夹图标并展开；其他项目关闭的文件夹', async () => {
    await renderShell();
    const cur = screen.getByTestId('sidebar.project-row:prj_dlintro');
    expect(cur).toHaveAttribute('aria-current', 'true');
    expect(cur).toHaveAttribute('aria-expanded', 'true');
    expect(cur).toHaveTextContent('(5)');
    expect(screen.getByTestId('sidebar.project-row:prj_paper_rag')).toHaveAttribute('aria-expanded', 'false');
  });

  it('点击其他项目：设为当前并展开，文件栏换成该项目材料；对话视图回到主页', async () => {
    window.history.replaceState(null, '', '/c/cnv_transformer');
    await renderShell();
    fireEvent.click(screen.getByTestId('sidebar.project-row:prj_paper_rag'));
    expect(useChat.getState().projectId).toBe('prj_paper_rag');
    expect(screen.getByTestId('sidebar.project-row:prj_paper_rag')).toHaveAttribute('aria-expanded', 'true');
    expect(useLayout.getState().view).toBe('home');
    await waitFor(() => expect(screen.getByTestId('files.panel.project-name')).toHaveTextContent('论文精读 · RAG'));
    expect(screen.queryByTestId('files.file-row:doc_attention')).not.toBeInTheDocument();
    // 展开态持久化到 mn.sidebar.v1
    expect(JSON.parse(localStorage.getItem(SIDEBAR_KEY)!).expandedIds).toContain('prj_paper_rag');
  });

  it('再点当前项目收起，再点展开', async () => {
    await renderShell();
    const row = screen.getByTestId('sidebar.project-row:prj_dlintro');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar.conversation-list:prj_dlintro')).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
  });

  it('展开中加载：对话区 2 行骨架', async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId('sidebar.project-row:prj_python_da'));
    const list = screen.getByTestId('sidebar.conversation-list:prj_python_da');
    expect(within(list).getByTestId('sidebar.conversation-list.loading').children).toHaveLength(2);
  });
});

describe('1-项目行-对话行', () => {
  it('分支数 > 0 显示分支图标与数字；= 0 显示相对时间', async () => {
    await renderShell();
    expect(screen.getByTestId('sidebar.conversation-row.branches:cnv_transformer')).toHaveTextContent('2');
    const hw = screen.getByTestId('sidebar.conversation-row:cnv_backprop_hw3');
    expect(hw).toHaveTextContent(relativeDay('2026-11-21T13:05:00Z'));
  });

  it('点击打开对话主线：URL /c/:cid，当前对话行 --sel 底色', async () => {
    await renderShell();
    const row = screen.getByTestId('sidebar.conversation-row:cnv_backprop_hw3');
    fireEvent.click(row);
    expect(window.location.pathname).toBe('/c/cnv_backprop_hw3');
    expect(useLayout.getState().view).toBe('conversation');
    expect(row).toHaveAttribute('aria-current', 'page');
    expect(row.parentElement).toHaveClass('bg-sel');
  });

  it('点击分支数：打开对话并在右栏打开最近一个 open 分支', async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId('sidebar.conversation-row.branches:cnv_transformer'));
    expect(window.location.pathname).toBe('/c/cnv_transformer');
    // fixture 里两个 open 分支，最近的是 br_onehot（06:31）
    await waitFor(() => expect(useLayout.getState().activeTab).toBe('branch:br_onehot'));
  });
});

describe('1-项目行-加载更多', () => {
  it('首页 3 条，点“加载更多”再取一页；没有更多时不渲染', async () => {
    await renderShell();
    const list = screen.getByTestId('sidebar.conversation-list:prj_dlintro');
    expect(within(list).getAllByTestId(/^sidebar\.conversation-row:/)).toHaveLength(3);
    const pageRequests: string[] = [];
    const onStart = ({ request }: { request: Request }) => {
      const u = new URL(request.url);
      if (u.pathname.endsWith('/conversations') && u.searchParams.get('cursor')) pageRequests.push(u.search);
    };
    server.events.on('request:start', onStart);
    const more = screen.getByTestId('sidebar.load-more:prj_dlintro');
    fireEvent.click(more);
    fireEvent.click(more); // 连续点击不重复请求
    fireEvent.click(more);
    await waitFor(() => expect(within(list).getAllByTestId(/^sidebar\.conversation-row:/)).toHaveLength(5));
    server.events.removeListener('request:start', onStart);
    expect(pageRequests).toEqual(['?cursor=cur_3&limit=20']);
    await waitFor(() => expect(within(list).getAllByTestId(/^sidebar\.conversation-row:/)).toHaveLength(5));
    expect(screen.queryByTestId('sidebar.load-more:prj_dlintro')).not.toBeInTheDocument();
  });
});

describe('1-项目栏-用户卡片', () => {
  it('头像为昵称首字，显示“本机”；点击打开设置', async () => {
    await renderShell();
    const card = screen.getByTestId('sidebar.user-card');
    expect(card).toHaveTextContent('我');
    expect(card).toHaveTextContent('本机');
    fireEvent.click(card);
    expect(useUI.getState().modal).toEqual({ kind: 'settings' });
  });
});
