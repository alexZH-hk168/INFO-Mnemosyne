// F1 外壳单元测试：1-启动-应用外壳、1-外壳-分栏拖拽条、1-外壳-栏收起按钮、1-外壳-收起态竖条、1-外壳-全局快捷键、1-外壳-全局提示
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { setMockScenario } from '../mocks/handlers';
import { worldControls } from '../mocks/world';
import { useChat } from '../store/chat';
import { DEFAULT_SIZES, useLayout } from '../store/layout';
import { useUI } from '../store/ui';
import { renderWithClient, server, setupMsw, setViewport } from '../test/f1-utils';
import FourPane from './FourPane';
import Toasts, { TOAST_AUTO_MS } from './Toasts';

setupMsw();

const persisted = () => JSON.parse(localStorage.getItem('mn.layout.v1') ?? '{}').state;

async function renderShell() {
  const r = renderWithClient(<FourPane />);
  await screen.findByTestId('sidebar.project-row:prj_dlintro');
  return r;
}

describe('1-启动-应用外壳', () => {
  it('首次加载：项目栏与文件栏显示骨架', () => {
    renderWithClient(<FourPane />);
    expect(screen.getByTestId('shell.app')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar.project-tree.loading')).toBeInTheDocument();
    expect(screen.getByTestId('files.list.loading')).toBeInTheDocument();
  });

  it('默认取项目列表第一个项目，四栏宽 252 / 236 / 弹性 / 右栏', async () => {
    await renderShell();
    await waitFor(() => expect(useChat.getState().projectId).toBe('prj_dlintro'));
    expect(screen.getByTestId('sidebar.panel').parentElement).toHaveStyle({ width: '252px' });
    expect(screen.getByTestId('files.panel').parentElement).toHaveStyle({ width: '236px' });
    // 1440 宽时右栏让位，保证对话栏 ≥ 480：1440 − 16 − 24 − 252 − 236 − 480 = 432
    expect(screen.getByTestId('right.placeholder').parentElement).toHaveStyle({ width: '432px' });
    act(() => setViewport(1680, 1050));
    await waitFor(() =>
      expect(screen.getByTestId('right.placeholder').parentElement).toHaveStyle({ width: `${DEFAULT_SIZES[3]}px` }),
    );
  });

  it('后端不可达：顶部显示“无法连接后端”，各栏保留骨架', async () => {
    // 模拟网络层失败（不是 HTTP 错误）
    server.use(http.get('*/api/projects', () => Response.error()));
    renderWithClient(<FourPane />);
    expect(await screen.findByTestId('shell.toast:offline')).toHaveTextContent('无法连接后端');
    expect(screen.getByTestId('shell.toast:offline')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('sidebar.project-tree.loading')).toBeInTheDocument();
  });

  it('项目列表为空时自动创建“默认项目”', async () => {
    worldControls.clearProjects();
    renderWithClient(<FourPane />);
    expect(await screen.findByText('默认项目')).toBeInTheDocument();
    await waitFor(() => expect(useChat.getState().projectId).toMatch(/^prj_new/));
  });

  it('窗口 < 1100 px 文件栏自动收起，< 900 px 项目栏也收起；不写 localStorage', async () => {
    setViewport(1000);
    await renderShell();
    expect(screen.getByTestId('shell.collapsed-rail:1')).toBeInTheDocument();
    expect(screen.queryByTestId('shell.collapsed-rail:0')).not.toBeInTheDocument();
    act(() => setViewport(850));
    expect(screen.getByTestId('shell.collapsed-rail:0')).toBeInTheDocument();
    expect(useLayout.getState().collapsed).toEqual([false, false, false, false]);
    expect(persisted()?.collapsed ?? [false, false, false, false]).toEqual([false, false, false, false]);
    // 窄窗口下手动展开文件栏：只是运行时状态
    fireEvent.click(screen.getByTestId('shell.collapsed-rail.expand:1'));
    expect(screen.getByTestId('files.panel')).toBeInTheDocument();
    expect(useLayout.getState().collapsed[1]).toBe(false);
  });

  it('直接打开 /c/:cid/b/:bid：右栏自动打开该分支标签，项目取自对话', async () => {
    window.history.replaceState(null, '', '/c/cnv_transformer/b/br_variance');
    renderWithClient(<FourPane />);
    expect(await screen.findByTestId('right.placeholder-tab:branch:br_variance')).toHaveTextContent('方差为什么是');
    expect(useLayout.getState().view).toBe('conversation');
    expect(useChat.getState()).toMatchObject({ conversationId: 'cnv_transformer', activeBranchId: 'br_variance' });
    await waitFor(() => expect(useChat.getState().projectId).toBe('prj_dlintro'));
  });

  it('/market/skills 打开市场页 Skill 标签；浏览器后退回到对话', async () => {
    window.history.replaceState(null, '', '/market/skills');
    await renderShell();
    expect(useLayout.getState()).toMatchObject({ view: 'market', marketRoute: { tab: 'skills' } });
    expect(screen.getByTestId('center.market-placeholder')).toBeInTheDocument();
    act(() => {
      window.history.pushState(null, '', '/c/cnv_backprop_hw3');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(useLayout.getState().view).toBe('conversation');
    expect(useChat.getState().conversationId).toBe('cnv_backprop_hw3');
  });
});

describe('1-外壳-分栏拖拽条', () => {
  it('role=separator，aria-valuenow 为当前宽度；← / → 每次 ±16 px', async () => {
    await renderShell();
    const h0 = screen.getByTestId('shell.resize-handle:0');
    expect(h0).toHaveAttribute('role', 'separator');
    expect(h0).toHaveAttribute('aria-orientation', 'vertical');
    expect(h0).toHaveAttribute('aria-valuenow', '252');
    fireEvent.keyDown(h0, { key: 'ArrowLeft' });
    expect(useLayout.getState().sizes[0]).toBe(236);
    expect(persisted().sizes[0]).toBe(236);
    // 右栏的拖拽条方向相反：← 让右栏变宽
    act(() => setViewport(1680, 1050));
    const h2 = screen.getByTestId('shell.resize-handle:2');
    fireEvent.keyDown(h2, { key: 'ArrowLeft' });
    expect(useLayout.getState().sizes[3]).toBe(576);
  });

  it('双击恢复默认宽度；拖不出最小/最大宽度', async () => {
    await renderShell();
    act(() => useLayout.getState().setSize(0, 330));
    fireEvent.doubleClick(screen.getByTestId('shell.resize-handle:0'));
    expect(useLayout.getState().sizes[0]).toBe(252);
    const h1 = screen.getByTestId('shell.resize-handle:1');
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(h1, { key: 'ArrowLeft' });
    expect(useLayout.getState().sizes[1]).toBe(200);
    act(() => useLayout.getState().setSize(1, 9999));
    expect(useLayout.getState().sizes[1]).toBe(340);
  });

  it('一侧收起时不渲染拖拽条', async () => {
    await renderShell();
    act(() => useLayout.getState().toggle(1));
    expect(screen.queryByTestId('shell.resize-handle:0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shell.resize-handle:1')).not.toBeInTheDocument();
    expect(screen.getByTestId('shell.resize-handle:2')).toBeInTheDocument();
  });
});

describe('1-外壳-栏收起按钮 / 1-外壳-收起态竖条', () => {
  it('三处收起按钮各收起对应栏并写入 localStorage', async () => {
    await renderShell();
    expect(screen.getByTestId('shell.collapse-button:0')).toHaveAccessibleName('收起项目栏');
    fireEvent.click(screen.getByTestId('shell.collapse-button:0'));
    fireEvent.click(screen.getByTestId('shell.collapse-button:1'));
    fireEvent.click(screen.getByTestId('shell.collapse-button:3'));
    expect(persisted().collapsed).toEqual([true, true, false, true]);
    expect(screen.getByTestId('shell.app')).toHaveAttribute('data-collapsed', '1101');
    expect(within(screen.getByTestId('shell.collapsed-rail:0')).getByText('项目')).toBeInTheDocument();
    expect(within(screen.getByTestId('shell.collapsed-rail:1')).getByText('文件')).toBeInTheDocument();
    expect(within(screen.getByTestId('shell.collapsed-rail:3')).getByText('预览')).toBeInTheDocument();
  });

  it('点竖条空白处展开，宽度恢复收起前的值', async () => {
    await renderShell();
    act(() => useLayout.getState().setSize(0, 300));
    fireEvent.click(screen.getByTestId('shell.collapse-button:0'));
    fireEvent.click(screen.getByTestId('shell.collapsed-rail:0'));
    expect(screen.getByTestId('sidebar.panel').parentElement).toHaveStyle({ width: '300px' });
  });

  it('右栏竖条显示已打开标签数；有新标签打开时自动展开', async () => {
    await renderShell();
    fireEvent.click(screen.getByTestId('shell.collapse-button:3'));
    expect(screen.queryByTestId('shell.collapsed-rail.tab-count')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('files.file-row:doc_attention'));
    expect(screen.queryByTestId('shell.collapsed-rail:3')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('shell.collapse-button:3'));
    expect(screen.getByTestId('shell.collapsed-rail.tab-count')).toHaveTextContent('1');
  });
});

describe('1-外壳-全局快捷键', () => {
  it('Alt(Option)+1 / Alt+2 切换左两栏（按 event.code），Ctrl 与 ⌘ 的 . 切换右栏，K 新建对话', async () => {
    await renderShell();
    // Mac 上 Option+1 的 e.key 是“¡”，只认 e.code
    fireEvent.keyDown(window, { key: '¡', code: 'Digit1', altKey: true });
    fireEvent.keyDown(window, { key: '2', code: 'Digit2', altKey: true });
    fireEvent.keyDown(window, { key: '.', code: 'Period', ctrlKey: true });
    expect(useLayout.getState().collapsed).toEqual([true, true, false, true]);
    fireEvent.keyDown(window, { key: '.', code: 'Period', metaKey: true });
    expect(useLayout.getState().collapsed[3]).toBe(false);
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', altKey: true });
    expect(useLayout.getState().collapsed[0]).toBe(false);
    // ⌘/Ctrl+1/2 是浏览器切换标签的键，不再处理；AltGr（Ctrl+Alt）也不拦截
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true });
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true, altKey: true });
    expect(useLayout.getState().collapsed[0]).toBe(false);
    act(() => {
      useChat.getState().setConversation('cnv_transformer');
      useLayout.getState().setView('conversation');
    });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(useLayout.getState().view).toBe('home');
    expect(useChat.getState().conversationId).toBeNull();
    expect(window.location.pathname).toBe('/');
  });

  it('输入框聚焦时 Alt+1 仍生效且不插入字符，普通字符不被拦截', async () => {
    await renderShell();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const ev = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    const alt = new KeyboardEvent('keydown', {
      key: '¡',
      code: 'Digit1',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(alt);
    expect(alt.defaultPrevented).toBe(true);
    expect(useLayout.getState().collapsed[0]).toBe(true);
    input.remove();
  });

  it('Esc 依次关闭：弹层 → 弹窗 → 划词工具条', async () => {
    await renderShell();
    act(() =>
      useUI.setState({
        popover: 'plugins',
        modal: { kind: 'settings' },
        selection: { message_id: 'm', start: 0, end: 1, quote: 'a', rect: { x: 0, y: 0, width: 1, height: 1 } },
      }),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUI.getState()).toMatchObject({ popover: null, modal: { kind: 'settings' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUI.getState().modal).toBeNull();
    expect(useUI.getState().selection).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUI.getState().selection).toBeNull();
  });
});

describe('1-外壳-全局提示', () => {
  it('info / success 4 s 后自动消失，role=status', () => {
    vi.useFakeTimers();
    try {
      renderWithClient(<Toasts />);
      let id = '';
      act(() => {
        id = useUI.getState().pushToast({ kind: 'info', text: '已复制' });
      });
      expect(screen.getByTestId(`shell.toast:${id}`)).toHaveAttribute('role', 'status');
      act(() => vi.advanceTimersByTime(TOAST_AUTO_MS - 10));
      expect(screen.getByTestId(`shell.toast:${id}`)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(20));
      expect(screen.queryByTestId(`shell.toast:${id}`)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('error 不自动消失，role=alert，可用键盘关闭；操作按钮执行回调', () => {
    vi.useFakeTimers();
    try {
      renderWithClient(<Toasts />);
      const onClick = vi.fn();
      let id = '';
      act(() => {
        id = useUI.getState().pushToast({ kind: 'error', text: '上传失败', action: { label: '重试', onClick } });
      });
      act(() => vi.advanceTimersByTime(TOAST_AUTO_MS * 3));
      const el = screen.getByTestId(`shell.toast:${id}`);
      expect(el).toHaveAttribute('role', 'alert');
      fireEvent.click(screen.getByTestId(`shell.toast.action:${id}`));
      expect(onClick).toHaveBeenCalledTimes(1);
      act(() => {
        id = useUI.getState().pushToast({ kind: 'error', text: '再次失败' });
      });
      const close = screen.getByTestId(`shell.toast.dismiss:${id}`);
      close.focus();
      expect(close).toHaveFocus();
      fireEvent.click(close); // 按钮获得焦点后 Enter/Space 触发 click
      expect(screen.queryByTestId(`shell.toast:${id}`)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('同时多于 3 条只显示最新 3 条', () => {
    renderWithClient(<Toasts />);
    act(() => {
      for (let i = 1; i <= 5; i += 1) useUI.getState().pushToast({ kind: 'error', text: `第 ${i} 条` });
    });
    const box = screen.getByTestId('shell.toast');
    expect(within(box).getAllByRole('alert')).toHaveLength(3);
    expect(box).toHaveTextContent('第 3 条');
    expect(box).not.toHaveTextContent('第 2 条');
    expect(box).toHaveTextContent('第 5 条');
  });
});

describe('场景开关仍交回 fixture 层', () => {
  it('GET /api/projects 指定 error 场景时项目栏显示“加载失败 · 重试”', async () => {
    setMockScenario('GET /api/projects', 'error');
    renderWithClient(<FourPane />);
    expect(await screen.findByTestId('sidebar.project-tree.retry')).toHaveTextContent('加载失败 · 重试');
  });
});
