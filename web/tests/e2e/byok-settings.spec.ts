// v0.5 [BYOK]：设置“模型”页（服务商预设、测试连接、Key 掩码与清除）与输入框演示模式提示。
// 默认 MSW 世界是“已配置自己的模型”（get-settings.ok.json）；清除 Key 并保存后回到演示模式。
import { expect, test } from '@playwright/test';
import { mock, openApp, shot } from './f1-helpers';

test('3-设置-模型：选服务商自动填地址与模型名，测试连接显示结果', async ({ page }) => {
  await openApp(page, '/');
  await mock(page, 'resetMarketWorld');
  await page.getByTestId('sidebar.user-card').click();
  await expect(page.getByTestId('settings.model.mode')).toHaveAttribute('data-mode', 'real');
  await expect(page.getByTestId('settings.model.api-key-hint')).toHaveText('••••a1b2');
  const provider = page.getByTestId('settings.model.provider');
  await expect(provider.locator('option')).toHaveCount(4);
  await provider.selectOption('deepseek');
  await expect(page.getByTestId('settings.dialog.api-base')).toHaveValue('https://api.deepseek.com');
  await expect(page.getByTestId('settings.dialog.chat-model')).toHaveValue('deepseek-v4-pro');
  await expect(page.getByTestId('settings.dialog.embedding-model')).toHaveValue('');
  await expect(page.getByTestId('settings.model.provider-notes')).toContainText('没有嵌入接口');
  await page.getByTestId('settings.model.test').click();
  const res = page.getByTestId('settings.model.test-result');
  await expect(res).toHaveAttribute('data-ok', 'true');
  await expect(res).toContainText('连接成功');
  await res.scrollIntoViewIfNeeded(); // 结果框在弹窗下方，截图前滚到可见
  await shot(page, '3-设置-模型');

  await mock(page, 'setTestResult', 'key-invalid');
  await page.getByTestId('settings.model.test').click();
  await expect(res).toHaveAttribute('data-ok', 'false');
  await expect(res).toContainText('密钥无效');
  await res.scrollIntoViewIfNeeded();
  await shot(page, '3-设置-模型-测试连接失败');
  await mock(page, 'setTestResult', null);
});

test('1-输入框-演示模式提示：清除 Key 保存后出现，“去设置”打开模型页', async ({ page }) => {
  await openApp(page, '/');
  await mock(page, 'resetMarketWorld');
  await expect(page.getByTestId('composer.box')).toBeVisible();
  await expect(page.getByTestId('composer.demo-notice')).toHaveCount(0);
  await page.getByTestId('sidebar.user-card').click();
  await page.getByTestId('settings.model.api-key-clear').click();
  await expect(page.getByTestId('settings.dialog.api-key')).toHaveAttribute('type', 'password');
  await page.getByTestId('settings.dialog.save').click();
  await expect(page.getByTestId('settings.model.mode')).toHaveAttribute('data-mode', 'demo');
  await expect(page.getByTestId('settings.model.mode')).toContainText('回答由本地示例生成');
  await expect(page.getByTestId('settings.model.test')).toBeDisabled();
  await shot(page, '3-设置-模型-演示模式');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings.dialog')).toHaveCount(0);

  const notice = page.getByTestId('composer.demo-notice');
  await expect(notice).toHaveText(/演示模式：未配置模型，回答由本地示例生成/);
  await shot(page, '1-输入框-演示模式提示');
  await page.getByTestId('composer.demo-notice.settings').click();
  await expect(page.getByTestId('settings.dialog.model')).toBeVisible();
  await page.keyboard.press('Escape');
  await mock(page, 'resetMarketWorld');
});
