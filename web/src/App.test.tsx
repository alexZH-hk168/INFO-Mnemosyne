import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { renderWithClient, setupMsw } from './test/f1-utils';

setupMsw();

describe('App', () => {
  it('渲染四栏外壳（F1 替换了 F0 的 tokens 占位页）', async () => {
    renderWithClient(<App />);
    expect(screen.getByTestId('shell.app')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar.panel')).toBeInTheDocument();
    expect(screen.getByTestId('files.panel')).toBeInTheDocument();
    expect(screen.getByTestId('center.pane')).toBeInTheDocument();
    expect(await screen.findByTestId('sidebar.project-row:prj_dlintro')).toBeInTheDocument();
  });
});
