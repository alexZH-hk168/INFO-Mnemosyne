// 上传：文件栏上传按钮、拖拽上传区、主页输入框共用 `uploadFiles(pid, files)`（规格 1-文件栏-拖拽上传区）。
import { api } from '../api/client';
import type { UploadResult } from '../api/endpoints';
import type { ID } from '../api/types';

/** 规格 1-文件栏-上传按钮：accept=".pdf,.pptx,.py,.js,.ts,.ipynb,.md,.txt" */
export const ACCEPTED_EXTENSIONS = ['.pdf', '.pptx', '.py', '.js', '.ts', '.ipynb', '.md', '.txt'] as const;
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

export function isAccepted(file: Pick<File, 'name'>): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
}

/** 拆成可上传与被拦截两组 */
export function splitAccepted<T extends Pick<File, 'name'>>(files: T[]): { ok: T[]; rejected: T[] } {
  const ok: T[] = [];
  const rejected: T[] = [];
  for (const f of files) (isAccepted(f) ? ok : rejected).push(f);
  return { ok, rejected };
}

export function rejectedText(rejected: Pick<File, 'name'>[]): string {
  const names = rejected.map((f) => f.name).join('、');
  return `不支持的文件类型：${names}。支持 PDF、PPTX、代码、Notebook、Markdown 与纯文本`;
}

/** POST /api/projects/{pid}/documents（multipart，字段名 file，可多个） */
export function uploadFiles(pid: ID, files: File[]): Promise<UploadResult> {
  const form = new FormData();
  for (const f of files) form.append('file', f, f.name);
  return api.post<UploadResult>(`/api/projects/${encodeURIComponent(pid)}/documents`, form);
}
