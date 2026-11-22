import { ApiRequestError } from '../api/client';

/** 网络层失败（后端不可达），区别于后端返回的 HTTP 错误 */
export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiRequestError && e.status === 0;
}
