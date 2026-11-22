// fetch 封装：统一加 JSON 头、统一把非 2xx 响应解析成 ApiRequestError。
// 错误体格式见 docs/contract/README.md 第 4 条：{ error: { code, message, retriable } }。
import type { ApiError, ErrorCode } from './types';

export class ApiRequestError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retriable: boolean;
  /** 错误体里可选的 `details`（契约 v0.2），如 PLUGIN_SELF_CHECK_FAILED 的 `log_tail` */
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status: number, retriable: boolean, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.retriable = retriable;
    if (details) this.details = details;
  }
}

function isApiError(x: unknown): x is ApiError {
  if (!x || typeof x !== 'object' || !('error' in x)) return false;
  const e = (x as { error: unknown }).error;
  return (
    !!e &&
    typeof e === 'object' &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}

/** 把任意失败响应转换成 ApiRequestError；响应体不是契约格式时按 INTERNAL 处理 */
export async function parseErrorResponse(res: Response): Promise<ApiRequestError> {
  const text = await res.text().catch(() => '');
  try {
    const body: unknown = JSON.parse(text);
    if (isApiError(body)) {
      return new ApiRequestError(
        body.error.code,
        body.error.message,
        res.status,
        Boolean(body.error.retriable),
        body.error.details,
      );
    }
  } catch {
    // 非 JSON，落到下面
  }
  return new ApiRequestError('INTERNAL', text || `HTTP ${res.status}`, res.status, res.status >= 500);
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
}

function withQuery(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** 发请求并按 Content-Type 解析：JSON → 对象，其余 → 文本 */
export async function apiFetch<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const init: RequestInit = { method, signal: opts.signal, headers: { Accept: 'application/json' } };
  if (opts.body instanceof FormData) {
    init.body = opts.body;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
  }
  let res: Response;
  try {
    res = await fetch(withQuery(path, opts.query), init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiRequestError('INTERNAL', `网络错误：${(e as Error).message}`, 0, true);
  }
  if (!res.ok) throw await parseErrorResponse(res);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('Content-Type') ?? '';
  return (type.includes('application/json') ? await res.json() : await res.text()) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => apiFetch<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => apiFetch<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => apiFetch<T>('PUT', path, { ...opts, body }),
  del: <T>(path: string, opts?: RequestOptions) => apiFetch<T>('DELETE', path, opts),
};
