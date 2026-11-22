// 浏览器端 MSW：开发模式下由 main.tsx 启动。
import { setupWorker } from 'msw/browser';
import { handlers, resetMockScenarios, setMockScenario } from './handlers';

export const worker = setupWorker(...handlers);

/** 手动调试用：在浏览器控制台 `__mnMock.setMockScenario('GET /api/projects', 'error')` */
export const mockControls = { setMockScenario, resetMockScenarios };
