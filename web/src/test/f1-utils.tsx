// F1 组件测试工具：MSW（有状态 world + fixture handlers）、相对 URL 补全、store 与 localStorage 复位、渲染外壳。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { setupServer } from 'msw/node';
import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { handlers, resetMockScenarios } from '../mocks/handlers';
import { resetWorld, worldHandlers } from '../mocks/world';
import { emptyDraft, NEW_MAIN, useChat } from '../store/chat';
import { DEFAULT_SIZES, useLayout } from '../store/layout';
import { useUI } from '../store/ui';

export const server = setupServer(...worldHandlers, ...handlers);
const ORIGIN = 'http://localhost';

export function setViewport(width: number, height = 900): void {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

export function resetStores(): void {
  useLayout.setState({
    sizes: [...DEFAULT_SIZES],
    collapsed: [false, false, false, false],
    rightTabs: [],
    activeTab: null,
    view: 'home',
    marketRoute: { tab: 'plugins' },
  });
  useChat.setState({
    projectId: null,
    conversationId: null,
    activeBranchId: null,
    streaming: null,
    composer: { [NEW_MAIN]: emptyDraft() },
  });
  useUI.setState({ modal: null, toasts: [], popover: null, selection: null });
}

/** 在测试文件顶层调用一次：启动 MSW，并把组件里的相对路径请求补成 http://localhost/... */
export function setupMsw(): void {
  let original: typeof fetch;
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
    original = globalThis.fetch;
    // jsdom 的 AbortSignal 不被 Node fetch 接受，测试里去掉 signal（只影响取消，不影响应答）
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const { signal: _signal, ...rest } = init ?? {};
      return original(typeof input === 'string' && input.startsWith('/') ? `${ORIGIN}${input}` : input, rest);
    }) as typeof fetch;
  });
  beforeEach(() => {
    localStorage.clear();
    resetWorld();
    resetStores();
    setViewport(1440);
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    resetMockScenarios();
    server.resetHandlers();
  });
  afterAll(() => {
    globalThis.fetch = original;
    server.close();
  });
}

export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}
