// 读材料原文：GET /api/documents/{did}/raw（契约 rest-api.md：PDF 原文件；PPTX 返回转换后的 PDF；code/md 返回 text/plain）。
// 规格把它放在各预览组件的内部 state 里（不是 TanStack Query key），这里只给组件用的小 hook。
import { useEffect, useState } from 'react';
import { ApiRequestError, parseErrorResponse } from '../api/client';
import type { ID } from '../api/types';

export const rawUrl = (did: ID) => `/api/documents/${encodeURIComponent(did)}/raw`;

async function fetchRaw(did: ID, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(rawUrl(did), { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiRequestError('INTERNAL', `网络错误：${(e as Error).message}`, 0, true);
  }
  if (!res.ok) throw await parseErrorResponse(res);
  return res;
}

export async function fetchRawBytes(did: ID, signal?: AbortSignal): Promise<ArrayBuffer> {
  return (await fetchRaw(did, signal)).arrayBuffer();
}

export async function fetchRawText(did: ID, signal?: AbortSignal): Promise<string> {
  return (await fetchRaw(did, signal)).text();
}

export type RawState<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ApiRequestError };

/** 打开时读一次原文；did 变化时重读，组件卸载时中止 */
export function useRaw<K extends 'bytes' | 'text'>(did: ID, as: K): RawState<K extends 'bytes' ? ArrayBuffer : string> {
  type T = K extends 'bytes' ? ArrayBuffer : string;
  const [state, setState] = useState<RawState<T>>({ status: 'loading' });
  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    const p = (as === 'bytes' ? fetchRawBytes(did, ac.signal) : fetchRawText(did, ac.signal)) as Promise<T>;
    p.then(
      (data) => setState({ status: 'ready', data }),
      (e: unknown) => {
        if ((e as Error).name === 'AbortError') return;
        setState({
          status: 'error',
          error: e instanceof ApiRequestError ? e : new ApiRequestError('INTERNAL', String(e), 0, true),
        });
      },
    );
    return () => ac.abort();
  }, [did, as]);
  return state;
}

/** 下载原文件：取回字节后用临时链接保存（文件名用材料标题） */
export async function downloadRaw(did: ID, filename: string): Promise<void> {
  const res = await fetchRaw(did);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
