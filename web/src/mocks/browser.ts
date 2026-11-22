// 浏览器端 MSW：开发模式下由 main.tsx 启动。
// F1：有状态的 worldHandlers 排在前面（上传/解析/新建项目/翻页），其余接口由 fixture handlers 应答。
// F3：chatWorldHandlers（新建对话、发送、重新生成、停止、切换兄弟回答）排在最前。
// F6 追加：marketWorldHandlers（市场、插件安装/卸载、会话插件、Skill、设置、记忆）同样排在 fixture handlers 前面。
import { setupWorker } from 'msw/browser';
import { chatWorldControls, chatWorldHandlers } from './chat-world';
import { handlers, resetMockScenarios, setMockScenario } from './handlers';
import { marketControls, marketWorldHandlers } from './market-world';
import { worldControls, worldHandlers } from './world';

export const worker = setupWorker(...chatWorldHandlers, ...worldHandlers, ...marketWorldHandlers, ...handlers);

/** 手动调试用：在浏览器控制台 `__mnMock.setMockScenario('GET /api/projects', 'error')` */
export const mockControls = {
  setMockScenario,
  resetMockScenarios,
  ...worldControls,
  ...chatWorldControls,
  ...marketControls,
};
