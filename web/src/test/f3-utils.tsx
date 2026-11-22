// F3 组件测试工具：在 F1 工具的基础上把有状态的对话模拟层（chat-world）排在最前。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { setupServer } from 'msw/node';
import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { resetComposerDefaults } from '../chat/Composer';
import { chatWorldHandlers, resetChatWorld } from '../mocks/chat-world';
import { handlers, resetMockScenarios } from '../mocks/handlers';
import { resetWorld, worldHandlers } from '../mocks/world';
import { emptyDraft, NEW_MAIN, useChat } from '../store/chat';
import { useEvidence } from '../store/evidence';
import { DEFAULT_SIZES, useLayout } from '../store/layout';
import { useUI } from '../store/ui';

export const server = setupServer(...chatWorldHandlers, ...worldHandlers, ...handlers);
const ORIGIN = 'http://localhost';

/** 记录经过 MSW 的请求（方法、路径、请求头、JSON 体） */
export interface SeenRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
export const seen: SeenRequest[] = [];

export function resetF3Stores(): void {
  useLayout.setState({
    sizes: [...DEFAULT_SIZES],
    collapsed: [false, false, false, false],
    rightTabs: [],
    activeTab: null,
    view: 'home',
    marketRoute: { tab: 'plugins' },
  });
  useChat.setState({
    projectId: 'prj_dlintro',
    conversationId: null,
    activeBranchId: null,
    streaming: null,
    turn: null,
    composer: { [NEW_MAIN]: emptyDraft() },
  });
  useEvidence.setState({ selectedEvidenceId: null, messageEvidence: [], hover: null });
  useUI.setState({ modal: null, toasts: [], popover: null, selection: null });
}

export function setupF3Msw(): void {
  let original: typeof fetch;
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
    server.events.on('request:start', async ({ request }) => {
      const url = new URL(request.url);
      let body: unknown;
      if (request.method !== 'GET' && (request.headers.get('content-type') ?? '').includes('json')) {
        body = await request
          .clone()
          .json()
          .catch(() => undefined);
      }
      seen.push({
        method: request.method,
        path: url.pathname + url.search,
        headers: Object.fromEntries(request.headers.entries()),
        body,
      });
    });
    original = globalThis.fetch;
    // jsdom 的 AbortSignal 不被 Node fetch 接受：去掉 signal（SSE 客户端断开时另外会 cancel reader），并把相对路径补成 http://localhost
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const { signal: _signal, ...rest } = init ?? {};
      // jsdom 的 FormData 交给 Node fetch 后无法还原成文件；上传相关的用例自行覆盖上传接口（真实上传在 e2e 里测）
      return original(typeof input === 'string' && input.startsWith('/') ? `${ORIGIN}${input}` : input, rest);
    }) as typeof fetch;
  });
  beforeEach(() => {
    seen.length = 0;
    localStorage.clear();
    resetWorld();
    resetChatWorld();
    resetF3Stores();
    resetComposerDefaults();
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
