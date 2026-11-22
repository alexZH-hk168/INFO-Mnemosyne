import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/** 后端（B1）完成前一律走 MSW；设 VITE_USE_MSW=false 可关闭 */
async function enableMocking() {
  if (import.meta.env.VITE_USE_MSW === 'false') return;
  const { worker, mockControls } = await import('./mocks/browser');
  (window as unknown as { __mnMock: typeof mockControls }).__mnMock = mockControls;
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
});
