// 规格：2-证据胶囊-PDF预览（right.pdf-preview）
// 入口：证据胶囊 / 来源列表 / 文件行，tab kind=pdf，ref_id=document_id；由证据打开时带 locator {page, sentence_ids, bbox}。
// 接口：GET /api/documents/{did}/raw（PDF 二进制）。读 useEvidence.selectedEvidenceId。渲染细节在 pdf/PdfViewer.tsx。
import type { Tab } from '../store/layout';
import PdfViewerCore, { type PdfTarget } from './pdf/PdfViewer';
import { useSelectedNumber, useTabEvidence } from './useEvidenceContext';

export default function PdfViewer({ tab }: { tab: Tab }) {
  const ev = useTabEvidence(tab);
  const number = useSelectedNumber();
  const loc = ev?.locator as { page?: unknown; bbox?: unknown } | undefined;
  const target: PdfTarget | null =
    ev && loc && typeof loc.page === 'number'
      ? { page: loc.page, bbox: loc.bbox, quote: ev.quote, tag: number ? `证据 ${number}` : '证据' }
      : null;
  return (
    <PdfViewerCore
      key={tab.ref_id}
      docId={tab.ref_id}
      title={tab.title}
      mode="scroll"
      testid="right.pdf-preview"
      target={target}
    />
  );
}
