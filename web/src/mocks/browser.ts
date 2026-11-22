// 浏览器端 MSW：开发模式下由 main.tsx 启动。
// F1：有状态的 worldHandlers 排在前面（上传/解析/新建项目/翻页），其余接口由 fixture handlers 应答。
import { setupWorker } from 'msw/browser';
import { handlers, resetMockScenarios, setMockScenario } from './handlers';
import { worldControls, worldHandlers } from './world';

export const worker = setupWorker(...worldHandlers, ...handlers);

/** 手动调试用：在浏览器控制台 `__mnMock.setMockScenario('GET /api/projects', 'error')` */
export const mockControls = { setMockScenario, resetMockScenarios, ...worldControls };
