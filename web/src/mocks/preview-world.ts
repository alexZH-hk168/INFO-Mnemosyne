// F4：右栏预览的模拟层——`GET /api/documents/{did}/raw` 对 PDF 与 PPTX（转换后的 PDF）返回 web/public/samples/ 里的示例文件。
// 文本类原文（代码、Markdown、Notebook）仍由 fixture 应答（get-documents-did-raw.*.ok.json）。
// 规则同其他 world：某接口用 setMockScenario 指定了场景时本层不处理。
import { bypass, http, HttpResponse, type HttpHandler } from 'msw';
import { getMockScenario } from './handlers';

/** 材料 id → 示例文件（来源与许可见 web/public/samples/README.md） */
export const SAMPLE_PDFS: Record<string, string> = {
  doc_attention: '/samples/attention-is-all-you-need.pdf',
  doc_l05_attention: '/samples/l05-attention-slides.mock.pdf',
  doc_l04_backprop: '/samples/l04-backprop-slides.mock.pdf',
};

export const previewWorldHandlers: HttpHandler[] = [
  http.get('*/api/documents/:did/raw', async ({ params, request }) => {
    if (getMockScenario('GET /api/documents/{did}/raw') !== undefined) return undefined;
    const file = SAMPLE_PDFS[String(params.did)];
    if (!file) return undefined;
    const res = await fetch(bypass(new URL(file, request.url)));
    const type = res.headers.get('Content-Type') ?? '';
    if (!res.ok || !type.includes('pdf')) {
      return HttpResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: '示例 PDF 不在本地：先运行 bash web/scripts/fetch-samples.sh',
            retriable: false,
          },
        },
        { status: 404 },
      );
    }
    return new HttpResponse(await res.arrayBuffer(), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    });
  }),
];
