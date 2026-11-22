// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server } from '../mocks/node';
import { fixtures, resetMockScenarios, setMockScenario } from '../mocks/handlers';
import type { RestFixture } from '../mocks/fixture-types';
import { ApiRequestError, api, parseErrorResponse } from './client';
import type { ProjectList } from './endpoints';

const BASE = 'http://localhost';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => resetMockScenarios());
afterAll(() => server.close());

describe('api client', () => {
  it('成功时解析 JSON', async () => {
    const data = await api.get<ProjectList>(`${BASE}/api/projects`);
    expect(data).toEqual((fixtures['get-projects.ok.json'] as RestFixture).body);
  });

  it('非 2xx 时抛 ApiRequestError，带 code / status / retriable', async () => {
    setMockScenario('POST /api/projects', 'error');
    const err = await api.post(`${BASE}/api/projects`, { name: '' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      retriable: false,
      message: '项目名需为 1–60 个字',
    });
  });

  it('非 JSON 文本响应按文本返回', async () => {
    const text = await api.get<string>(`${BASE}/api/documents/doc_transformer_py/raw`);
    expect(text).toBe((fixtures['get-documents-did-raw.ok.json'] as RestFixture).body);
  });

  it('错误体不符合契约时归为 INTERNAL', async () => {
    const e = await parseErrorResponse(new Response('<html>bad gateway</html>', { status: 502 }));
    expect(e).toMatchObject({ code: 'INTERNAL', status: 502, retriable: true });
  });

  it('查询参数会拼进 URL，空值被忽略', async () => {
    const data = await api.get(`${BASE}/api/memory/items`, { query: { status: 'active', q: '', scope: undefined } });
    expect(data).toEqual((fixtures['get-memory-items.ok.json'] as RestFixture).body);
  });
});
