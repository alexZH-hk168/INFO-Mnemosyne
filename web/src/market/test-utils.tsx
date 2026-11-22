// F6 组件测试工具：在 F1 的 MSW 测试服务器上叠加 F6 的有状态市场层，并在每条测试前复位。
import { beforeEach } from 'vitest';
import { marketControls, marketWorldHandlers, resetMarketWorld } from '../mocks/market-world';
import { server, setupMsw } from '../test/f1-utils';

export { renderWithClient, server, setViewport } from '../test/f1-utils';

/** 在测试文件顶层调用一次 */
export function setupMarketMsw(): void {
  setupMsw();
  beforeEach(() => {
    resetMarketWorld();
    marketControls.setSelfCheckMs(30);
    marketControls.setModelUnavailable(false);
    server.use(...marketWorldHandlers); // afterEach 的 resetHandlers 会清掉，下一条测试重新叠加
  });
}
