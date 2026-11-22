// fixture 文件的外层格式（docs/contract/fixtures/*.json）。只描述“样例怎么存”，不属于接口契约本身。
import type { SseEvent } from '../api/types';

export interface FixtureRequest {
  /** 路径参数，键名与 rest-api.md 路径里的占位一致（pid、cid、mid、bid、did、eid、sid、id） */
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** multipart 上传时的文件名（仅 POST /api/projects/{pid}/documents） */
  files?: string[];
}

export interface RestFixture {
  /** `方法 路径`，路径与 rest-api.md 完全一致 */
  endpoint: string;
  kind: 'ok' | 'error';
  description: string;
  request?: FixtureRequest;
  status: number;
  /** 缺省为 application/json；`raw` 接口用 text/plain 等 */
  content_type?: string;
  body: unknown;
}

export interface SseFixture {
  endpoint: string;
  kind: 'sse';
  description: string;
  request?: FixtureRequest;
  status: 200;
  content_type: 'text/event-stream';
  events: SseEvent[];
  /** 演示断线：服务端推完 seq ≤ 该值的事件后断开连接 */
  disconnect_after_seq?: number;
}

export type Fixture = RestFixture | SseFixture;

export interface FixtureFile {
  /** 文件名（不含目录），如 `get-projects.ok.json` */
  file: string;
  content: Fixture;
}
