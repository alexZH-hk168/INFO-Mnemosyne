// 文件栏展示规则：分组标题、类型色块、右侧元信息、对应的右栏标签类型。
// 来源：规格 1-外壳-文件栏、1-文件分组-文件行；契约 Document（v0.2）。
import type { DocGroup, Document } from '../api/types';
import type { Tab, TabKind } from '../store/layout';
import { extensionOf } from './upload';

export const GROUP_LABEL: Record<DocGroup, string> = {
  paper: '论文',
  slides: '课件',
  code: '代码',
  notes: '笔记',
  web: '网页来源',
};

/** 类型色块文字与配色（tailwind 的 ft-* 颜色来自 tokens.css） */
export function badgeOf(doc: Pick<Document, 'kind' | 'title'>): { label: string; cls: string } {
  switch (doc.kind) {
    case 'pdf':
      return { label: 'PDF', cls: 'bg-ft-pdf' };
    case 'pptx':
      return { label: 'PPT', cls: 'bg-ft-pptx' };
    case 'ipynb':
      return { label: 'NB', cls: 'bg-ft-ipynb' };
    case 'md':
      return { label: extensionOf(doc.title) === '.txt' ? 'TXT' : 'MD', cls: 'bg-ft-md' };
    case 'code': {
      const ext = extensionOf(doc.title).replace('.', '').toUpperCase();
      return { label: ext && ext.length <= 3 ? ext : 'CODE', cls: 'bg-ft-code' };
    }
    case 'web':
      return { label: 'WEB', cls: 'bg-surface' };
  }
}

/** 右侧元信息：解析中“解析 62%”；ready 时页数 / 行数 / 格数 */
export function metaOf(doc: Document): string {
  if (doc.parse_status === 'queued' || doc.parse_status === 'parsing') return `解析 ${Math.round(doc.progress)}%`;
  if (doc.parse_status === 'failed') return '';
  if (doc.kind === 'ipynb' && doc.cells != null) return `${doc.cells} 格`;
  if ((doc.kind === 'pdf' || doc.kind === 'pptx') && doc.pages != null) return `${doc.pages} 页`;
  if ((doc.kind === 'code' || doc.kind === 'md') && doc.lines != null) return `${doc.lines} 行`;
  return '';
}

/** 文件行点开后的右栏标签类型（ipynb 走代码预览） */
export function tabKindOf(doc: Pick<Document, 'kind'>): TabKind {
  switch (doc.kind) {
    case 'pdf':
      return 'pdf';
    case 'pptx':
      return 'pptx';
    case 'code':
    case 'ipynb':
      return 'code';
    case 'md':
      return 'md';
    case 'web':
      return 'web';
  }
}

/** 右栏标签 id 统一写成 `kind:ref_id`，同一 kind+ref_id 只开一个（state.md openTab） */
export function tabFor(kind: TabKind, refId: string, title: string): Tab {
  return { id: `${kind}:${refId}`, kind, ref_id: refId, title };
}
