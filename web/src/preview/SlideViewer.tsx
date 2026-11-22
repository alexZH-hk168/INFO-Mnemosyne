// 规格：2-证据胶囊-PPT预览（right.slide-preview）
// PPTX 由后端转成 PDF（GET /api/documents/{did}/raw 返回转换后的 PDF），复用 PDF 预览组件：单页模式 + 缩略图条，定位到 locator.slide 页。
// v1 不高亮具体文本框。转换失败（材料 parse_status=failed 或原文读不到）显示“预览生成失败”。
import { useDocument } from '../api/queries';
import type { Tab } from '../store/layout';
import PdfViewerCore, { type PdfTarget } from './pdf/PdfViewer';
import { useTabEvidence } from './useEvidenceContext';

export default function SlideViewer({ tab }: { tab: Tab }) {
  const ev = useTabEvidence(tab);
  const doc = useDocument(tab.ref_id);
  const loc = ev?.locator as { slide?: unknown } | undefined;
  const target: PdfTarget | null =
    ev && loc && typeof loc.slide === 'number' ? { page: loc.slide, noHighlight: true } : null;
  return (
    <PdfViewerCore
      key={tab.ref_id}
      docId={tab.ref_id}
      title={tab.title}
      mode="single"
      testid="right.slide-preview"
      target={target}
      failed={doc.data?.parse_status === 'failed'}
      failedText="预览生成失败"
    />
  );
}
