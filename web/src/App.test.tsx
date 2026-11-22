import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

describe('F0 占位页', () => {
  it('渲染标题与 MSW 状态行（请求中）', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('f0.placeholder')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Mnemosyne' })).toBeInTheDocument();
    expect(screen.getByTestId('f0.msw-status')).toHaveTextContent('正在请求');
    vi.unstubAllGlobals();
  });
});
