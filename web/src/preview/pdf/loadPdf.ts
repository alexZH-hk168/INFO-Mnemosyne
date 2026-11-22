// pdf.js 懒加载：首次打开 PDF 时才下载 pdfjs-dist 与 worker（pdfjs-dist，Apache-2.0）。
import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');
let lib: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  if (!lib) {
    lib = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, worker]) => {
      m.GlobalWorkerOptions.workerSrc = worker.default;
      return m;
    });
  }
  return lib;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** 释放 worker 与文档 */
  destroy: () => Promise<void>;
}

export async function openPdf(data: ArrayBuffer): Promise<OpenedPdf> {
  const m = await loadPdfJs();
  // pdf.js 会转移 ArrayBuffer 的所有权，传副本，原数据还要留给“下载”
  const task = m.getDocument({ data: new Uint8Array(data.slice(0)) });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}
