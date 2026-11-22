// F1 文件栏单元测试：1-外壳-文件栏、1-文件栏-上传按钮、1-文件栏-拖拽上传区、1-文件栏-文件分组、
// 1-文件分组-文件行、1-文件行-解析失败重试、1-文件分组-网页来源行
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { delay, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FourPane from '../layout/FourPane';
import { setMockScenario } from '../mocks/handlers';
import { worldControls } from '../mocks/world';
import { useChat } from '../store/chat';
import { useLayout } from '../store/layout';
import { useUI } from '../store/ui';
import { renderWithClient, server, setupMsw } from '../test/f1-utils';
import { DOC_DRAG_TYPE } from './FileRow';

// jsdom 的 FormData 不能经 Node fetch 发出，上传请求本身在 mocks/world.test.ts（node 环境）与端到端测试里验证；
// 这里只验证组件把哪些文件交给 uploadFiles、以及前端拦截。
const uploadSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/upload', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/upload')>();
  return { ...mod, uploadFiles: uploadSpy };
});

setupMsw();
beforeEach(() => {
  uploadSpy.mockReset();
  uploadSpy.mockResolvedValue({ documents: [], job_ids: [] });
});

async function renderShell() {
  const r = renderWithClient(<FourPane />);
  await screen.findByTestId('files.file-row:doc_attention');
  return r;
}

const file = (name: string, type = 'application/octet-stream') => new File(['x'], name, { type });

describe('1-外壳-文件栏', () => {
  it('标题“文件 · 项目名”，分组顺序 论文、课件、代码、笔记、网页来源', async () => {
    await renderShell();
    expect(screen.getByTestId('files.panel.project-name')).toHaveTextContent('深度学习导论');
    const groups = screen.getAllByTestId(/^files\.group:/).map((g) => g.getAttribute('data-testid'));
    expect(groups).toEqual([
      'files.group:paper',
      'files.group:slides',
      'files.group:code',
      'files.group:notes',
      'files.group:web',
    ]);
    expect(within(screen.getByTestId('files.group:slides')).getByText('课件')).toBeInTheDocument();
    // 横版 PDF“L04 反向传播”按 group 进课件组（契约 v0.2）
    expect(
      within(screen.getByTestId('files.group:slides')).getByTestId('files.file-row:doc_l04_backprop'),
    ).toBeInTheDocument();
  });

  it('加载中 4 行骨架；请求失败“加载失败 · 重试”', async () => {
    setMockScenario('GET /api/projects/{pid}/documents', 'error');
    renderWithClient(<FourPane />);
    expect(screen.getByTestId('files.list.loading').children).toHaveLength(4);
    expect(await screen.findByTestId('files.list.retry')).toHaveTextContent('加载失败 · 重试');
  });

  it('无材料：只显示拖拽区；新对话且无材料时默认收起，手动展开后保持展开', async () => {
    await renderShell();
    act(() => useChat.getState().setProject('prj_en_writing'));
    await waitFor(() => expect(screen.getByTestId('shell.collapsed-rail:1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('shell.collapsed-rail.expand:1'));
    const panel = screen.getByTestId('files.panel');
    expect(within(panel).queryAllByTestId(/^files\.group:/)).toHaveLength(0);
    expect(within(panel).getByTestId('files.dropzone')).toHaveTextContent('拖入 PDF / PPT / 代码，自动解析并建索引');
    expect(useLayout.getState().collapsed[1]).toBe(false); // 自动收起不写入持久化状态
  });
});

describe('1-文件栏-文件分组', () => {
  it('组标题右侧数量与行数一致', async () => {
    await renderShell();
    for (const g of screen.getAllByTestId(/^files\.group:/)) {
      const key = g.getAttribute('data-testid')!.split(':')[1];
      const rows = within(g).getAllByTestId(/^files\.(file|web)-row:/);
      expect(within(g).getByTestId(`files.group.count:${key}`)).toHaveTextContent(String(rows.length));
    }
  });
});

describe('1-文件分组-文件行', () => {
  it('ready：右侧页数/行数/格数，类型色块', async () => {
    await renderShell();
    expect(screen.getByTestId('files.file-row.meta:doc_attention')).toHaveTextContent('15 页');
    expect(screen.getByTestId('files.file-row.meta:doc_transformer_py')).toHaveTextContent('212 行');
    expect(screen.getByTestId('files.file-row.meta:doc_train_ipynb')).toHaveTextContent('14 格');
    expect(screen.getByTestId('files.file-row:doc_transformer_py')).toHaveTextContent('PY');
    expect(screen.getByTestId('files.file-row:doc_train_ipynb')).toHaveTextContent('NB');
    expect(screen.getByTestId('files.file-row:doc_l05_attention')).toHaveTextContent('PPT');
  });

  it('parsing：“解析 62%”，不可点开预览', async () => {
    await renderShell();
    const row = screen.getByTestId('files.file-row:doc_longmemeval');
    expect(screen.getByTestId('files.file-row.meta:doc_longmemeval')).toHaveTextContent('解析 62%');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(row);
    expect(useLayout.getState().rightTabs).toHaveLength(0);
  });

  it('点击 ready 的 PDF：右栏出现该文件标签，行变为选中样式；可拖到输入框', async () => {
    await renderShell();
    const row = screen.getByTestId('files.file-row:doc_attention');
    fireEvent.click(row);
    expect(useLayout.getState().rightTabs).toEqual([
      { id: 'pdf:doc_attention', kind: 'pdf', ref_id: 'doc_attention', title: 'Attention Is All You Need' },
    ]);
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('right.tabs.tab:pdf:doc_attention')).toBeInTheDocument();
    const data = new Map<string, string>();
    fireEvent.dragStart(row, {
      dataTransfer: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' },
    });
    expect(data.get(DOC_DRAG_TYPE)).toBe('doc_attention');
  });

  it('failed：文件名旁红点（悬停显示 parse_error），右侧“重试”', async () => {
    await renderShell();
    act(() => void worldControls.failDocument('doc_longmemeval', 'PDF 已加密，无法提取文字'));
    act(() => useLayout.getState().setView('home'));
    // 触发一次重新读取
    fireEvent.click(screen.getByTestId('sidebar.project-row:prj_paper_rag'));
    fireEvent.click(screen.getByTestId('sidebar.project-row:prj_dlintro'));
    const dot = await screen.findByTestId('files.file-row.error-dot:doc_longmemeval');
    expect(dot).toHaveAttribute('aria-label', '解析失败：PDF 已加密，无法提取文字');
    expect(screen.getByTestId('files.file-row:doc_longmemeval')).toHaveAttribute('title', 'PDF 已加密，无法提取文字');
    expect(screen.getByTestId('files.reparse:doc_longmemeval')).toHaveTextContent('重试');
  });
});

describe('1-文件行-解析失败重试', () => {
  it('点击后 POST reparse，行回到解析中，提交中按钮禁用', async () => {
    worldControls.failDocument('doc_longmemeval', 'PDF 已加密，无法提取文字');
    renderWithClient(<FourPane />);
    // 让 reparse 晚 150 ms 应答（之后交给 world 层处理），以便看到提交中状态
    server.use(http.post('*/api/documents/:did/reparse', () => delay(150).then(() => undefined)));
    const btn = await screen.findByTestId('files.reparse:doc_longmemeval');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    await waitFor(() =>
      expect(screen.getByTestId('files.file-row.meta:doc_longmemeval')).toHaveTextContent(/^解析 \d+%$/),
    );
    expect(screen.queryByTestId('files.reparse:doc_longmemeval')).not.toBeInTheDocument();
  });
});

describe('1-文件分组-网页来源行', () => {
  it('地球图标、标题、“引用 N”；点击在右栏打开网页快照（ref_id = snapshot_id）', async () => {
    await renderShell();
    const row = screen.getByTestId('files.web-row:doc_web_illustrated');
    expect(row).toHaveTextContent('The Illustrated Transformer');
    expect(row).toHaveTextContent('引用 1');
    fireEvent.click(row);
    expect(useLayout.getState().rightTabs[0]).toMatchObject({ kind: 'web', ref_id: 'ws_jalammar_illustrated' });
  });
});

describe('1-文件栏-上传按钮', () => {
  it('accept 限定类型、可多选；一次选 3 个文件全部提交上传', async () => {
    await renderShell();
    const input = screen.getByTestId('files.upload-button.input') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', '.pdf,.pptx,.py,.js,.ts,.ipynb,.md,.txt');
    expect(input.multiple).toBe(true);
    const files = [file('a.pdf'), file('b.py'), file('c.md')];
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    expect(uploadSpy.mock.calls[0][0]).toBe('prj_dlintro');
    expect((uploadSpy.mock.calls[0][1] as File[]).map((f) => f.name)).toEqual(['a.pdf', 'b.py', 'c.md']);
  });

  it('上传中图标变转圈；不支持的类型前端拦截并提示', async () => {
    let resolve: (v: unknown) => void = () => {};
    uploadSpy.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderShell();
    const input = screen.getByTestId('files.upload-button.input');
    fireEvent.change(input, { target: { files: [file('作业3.docx'), file('ok.pdf')] } });
    await waitFor(() => expect(screen.getByTestId('files.upload-button')).toHaveAttribute('aria-busy', 'true'));
    expect((uploadSpy.mock.calls[0][1] as File[]).map((f) => f.name)).toEqual(['ok.pdf']);
    expect(useUI.getState().toasts.at(-1)).toMatchObject({ kind: 'error' });
    expect(useUI.getState().toasts.at(-1)?.text).toContain('作业3.docx');
    await act(async () => resolve({ documents: [], job_ids: [] }));
    await waitFor(() => expect(screen.getByTestId('files.upload-button')).not.toHaveAttribute('aria-busy'));
  });
});

describe('1-文件栏-拖拽上传区', () => {
  it('拖入悬停：虚线变实线并加底色；松手提交上传', async () => {
    await renderShell();
    const panel = screen.getByTestId('files.panel');
    const zone = screen.getByTestId('files.dropzone');
    const dt = { types: ['Files'], files: [file('拖入.pdf')], dropEffect: '' };
    fireEvent.dragEnter(panel, { dataTransfer: dt });
    expect(zone).toHaveAttribute('data-active', 'true');
    expect(zone).toHaveClass('border-solid');
    fireEvent.drop(panel, { dataTransfer: dt });
    expect(zone).not.toHaveAttribute('data-active');
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    expect((uploadSpy.mock.calls[0][1] as File[])[0].name).toBe('拖入.pdf');
  });

  it('不支持的类型：松手后提示，不上传', async () => {
    await renderShell();
    const panel = screen.getByTestId('files.panel');
    fireEvent.drop(panel, { dataTransfer: { types: ['Files'], files: [file('图片.png')] } });
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(useUI.getState().toasts.at(-1)?.text).toContain('图片.png');
  });
});
