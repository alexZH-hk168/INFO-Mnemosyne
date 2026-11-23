// F3 端到端：输入框、对话流、SSE 客户端、证据胶囊（规格 04-输入框 九份、05-对话栏 F3 范围内十一份）。
// 跑法：MN_PORT=5173 npx playwright test tests/e2e/f3-chat.spec.ts --workers=2
// 截图 1440×900 存 tests/screenshots/<规格名>.png。
import { expect, test, type Page } from '@playwright/test';
import { mock, openApp, shot } from './f1-helpers';

const composer = (page: Page) => page.getByTestId('composer.box');
const textbox = (page: Page) => composer(page).getByRole('textbox');

async function openConversation(page: Page, cid = 'cnv_transformer') {
  await openApp(page, `/c/${cid}`, { fixedClock: true });
  await expect(page.getByTestId('chat.panel')).toBeVisible();
  await expect(page.getByTestId('chat.assistant-message:msg_tf_a2')).toBeVisible();
  // 等证据（历史消息的胶囊位置）加载完
  await expect(page.getByTestId('chat.evidence-chip:msg_tf_a1:E1')).toHaveText('1 · p.4');
}

async function sendText(page: Page, text: string) {
  await textbox(page).fill(text);
  await textbox(page).press('Enter');
}

test.describe('完整回合', () => {
  test('主页发送：建对话 → 地址变 /c/:cid → 项目栏出现新对话 → 步骤、正文、胶囊依次出现并保存', async ({ page }) => {
    await openApp(page, '/', { fixedClock: true });
    await expect(textbox(page)).toBeFocused();
    await shot(page, '1-外壳-输入框');
    await sendText(page, '结合第 5 讲课件，讲讲注意力为什么要除以 √dₖ');
    await expect(page).toHaveURL(/\/c\/cnv_new\d+$/);
    const cid = page.url().split('/').pop()!;
    await expect(page.getByTestId(`sidebar.conversation-row:${cid}`)).toBeVisible();
    // 乐观插入的用户消息
    await expect(
      page.getByTestId('chat.message-list').getByText('结合第 5 讲课件，讲讲注意力为什么要除以 √dₖ'),
    ).toBeVisible();
    // 输入框换成对话栏 variant 并获得焦点
    await expect(composer(page)).toHaveAttribute('data-variant', 'chat');
    await expect(textbox(page)).toBeFocused();
    // 生成中：停止键、步骤行转圈
    await expect(page.getByTestId('composer.send')).toHaveAttribute('data-state', 'stop');
    const trail = page.locator('[data-testid^="chat.step-trail:"]').last();
    await expect(trail).toBeVisible();
    // 模拟流每 80 ms 一个事件，胶囊“待确认”只持续约 0.4 s：虚线状态在单元测试里验，这里截生成中的画面
    await shot(page, '1-消息列表-助手回答');
    await expect(page.locator('[data-testid^="chat.assistant-message:"][data-status="saved"]')).toHaveCount(1, {
      timeout: 15_000,
    });
    const answer = page.locator('[data-testid^="chat.assistant-message:"][data-status="saved"]');
    await expect(answer.locator('[data-state="supported"]')).toHaveCount(1);
    await expect(answer.locator('[data-state="partial"]')).toHaveCount(1);
    await expect(answer.getByText('推断')).toBeVisible();
    await expect(page.getByTestId('chat.panel.title')).toHaveText('结合第 5 讲课件，讲讲注意力为什么要除'); // 模拟后端取前 20 个字作标题（U21）
    await expect(page.getByTestId('composer.send')).toHaveAttribute('data-state', 'disabled');
    await shot(page, '1-对话栏-消息列表');
  });

  test('对话中追问：新一轮接在最后，滚到底部；用户消息右对齐', async ({ page }) => {
    await openConversation(page);
    await sendText(page, '那多头注意力里，每个头的 dₖ 是多少？');
    const users = page.locator('[data-testid^="chat.user-message:"]');
    await expect(users).toHaveCount(3);
    await expect(page.locator('[data-testid^="chat.assistant-message:"][data-status="saved"]')).toHaveCount(3, {
      timeout: 15_000,
    });
    const list = page.getByTestId('chat.message-list');
    const atBottom = await list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60);
    expect(atBottom).toBe(true);
    const ub = (await users.last().boundingBox())!;
    const lb = (await list.boundingBox())!;
    expect(ub.x + ub.width).toBeGreaterThan(lb.x + lb.width / 2 + 100);
    await shot(page, '1-消息列表-用户消息');
  });
});

test.describe('对话栏与证据', () => {
  test('打开对话：头部标题、主线消息、底部输入框（对照 UI-05 中间栏）', async ({ page }) => {
    await openConversation(page);
    await expect(page.getByTestId('chat.panel.title')).toHaveText('Transformer 注意力精读');
    await expect(page.getByTestId('chat.user-message:msg_bv_u1')).toHaveCount(0);
    await page.getByTestId('chat.message-list').evaluate((el) => (el.scrollTop = 0));
    await shot(page, '1-对话行-对话栏');
  });

  test('胶囊：悬停 300 ms 出原句浮层；点击选中并打开右栏标签', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('chat.message-list').evaluate((el) => (el.scrollTop = 0));
    const chip = page.getByTestId('chat.evidence-chip:msg_tf_a1:E1');
    await chip.hover();
    const hover = page.getByTestId('chat.evidence-hover');
    await expect(hover).toBeVisible();
    await expect(hover).toContainText('Attention Is All You Need');
    await expect(hover).toContainText('第 4 页');
    await expect(hover).toContainText('To illustrate why the dot products get large');
    // 浮层在胶囊上方
    const hb = (await hover.boundingBox())!;
    const cb = (await chip.boundingBox())!;
    expect(hb.y + hb.height).toBeLessThanOrEqual(cb.y + 1);
    await shot(page, '2-证据胶囊-原句浮层');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // 右栏现在是 F1 占位，标签由 useLayout.openTab 打开（预览内容 F4）
    await expect(page.getByTestId('right.panel').getByText('Attention Is All You Need')).toBeVisible();
    await page.mouse.move(5, 450);
    await expect(hover).toBeHidden();
    await shot(page, '1-助手回答-证据胶囊');
  });

  test('推断标记与来源列表；E3 removed 不显示', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('chat.message-list').evaluate((el) => (el.scrollTop = 0));
    await expect(page.getByTestId('chat.inference-mark:msg_tf_a1:cit_tf1_2')).toHaveText('推断');
    await expect(page.getByTestId('chat.evidence-chip:msg_tf_a1:E3')).toHaveCount(0);
    await shot(page, '1-助手回答-推断标记');
    const src = page.getByTestId('chat.source-list:msg_tf_a1');
    await expect(src.locator('[data-testid^="chat.source-list.item:"]')).toHaveCount(2);
    await src.getByTestId('chat.source-list.item:evd_l05_s18').click();
    await expect(page.getByTestId('chat.evidence-chip:msg_tf_a1:E2')).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '1-助手回答-来源列表');
  });

  test('步骤行：摘要与 UI-05 格式一致，点击展开明细', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('chat.message-list').evaluate((el) => (el.scrollTop = 0));
    const trail = page.getByTestId('chat.step-trail:msg_tf_a1');
    // INT2（U110）：历史消息的证据里没有 message 类，召回步骤 label 表明找到过 → “参考历史对话”（不带数字）
    await expect(trail).toContainText('检索 2 份材料、1 个网页，参考历史对话');
    await expect(trail).toContainText('3 步 · 9 秒'); // U35：整轮耗时
    await trail.click();
    await expect(page.getByTestId('chat.step-trail.detail:msg_tf_a1')).toBeVisible();
    await expect(page.getByTestId('chat.step-trail.detail:msg_tf_a1')).not.toContainText('记忆');
    await shot(page, '1-助手回答-步骤行');
  });

  test('重新生成：新回答是兄弟并切过去（2/2），‹ 切回原回答（1/2）', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('chat.assistant-message:msg_tf_a2').hover();
    await page.getByTestId('chat.regenerate:msg_tf_a2').click();
    await expect(page.getByTestId('chat.assistant-message:msg_tf_a2')).toHaveCount(0);
    const count = page.locator('[data-testid^="chat.regenerate.count:"]');
    await expect(count).toHaveText('2/2', { timeout: 15_000 });
    await count.hover();
    await page.waitForTimeout(300); // 操作条淡入
    await shot(page, '1-助手回答-重新生成与切换');
    await page.locator('[data-testid^="chat.regenerate.prev:"]').click();
    await expect(page.getByTestId('chat.regenerate.count:msg_tf_a2')).toHaveText('1/2');
  });
});

test.describe('停止与断线', () => {
  test('停止：保留已生成内容，以“已停止生成”结束', async ({ page }) => {
    await openConversation(page);
    await sendText(page, '停在一半');
    const stop = page.getByTestId('composer.send');
    await expect(stop).toHaveAttribute('data-state', 'stop');
    await expect(page.locator('[data-testid^="chat.step-trail:msg_m"]')).toBeVisible();
    await shot(page, '1-输入框-发送停止按钮');
    await stop.click();
    await expect(page.locator('[data-testid^="chat.assistant-message.cancelled:"]')).toHaveText('已停止生成', {
      timeout: 10_000,
    });
    await expect(stop).not.toHaveAttribute('data-state', 'stop');
  });

  test('断线续流：第 5 个事件后断开，1 s 后续流，内容完整无重复', async ({ page }) => {
    await openConversation(page);
    await mock(page, 'setMockScenario', 'POST /api/conversations/{cid}/messages', 'sse-turn-resume.json');
    await sendText(page, '断线试试');
    await expect(page.getByTestId('chat.stream-client.reconnecting')).toBeVisible({ timeout: 10_000 });
    await shot(page, '1-对话栏-流式连接');
    const answer = page.getByTestId('chat.answer-body:msg_rs_a1');
    await expect(page.getByTestId('chat.assistant-message:msg_rs_a1')).toHaveAttribute('data-status', 'saved', {
      timeout: 15_000,
    });
    const text = await answer.innerText();
    expect(text.match(/一句话/g)).toHaveLength(1);
    expect(text).toContain('训练更稳定');
  });
});

test.describe('输入框控件', () => {
  test('联网检索开关、引用范围菜单、模型档位菜单', async ({ page }) => {
    await openConversation(page);
    const web = page.getByTestId('composer.web-toggle');
    await web.click();
    await expect(web).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '1-输入框-联网检索开关');
    await page.getByTestId('composer.scope').click();
    await expect(page.getByTestId('composer.scope.menu')).toBeVisible();
    await shot(page, '1-输入框-引用范围');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('composer.scope.menu')).toBeHidden();
    await expect(page.getByTestId('composer.scope')).toBeFocused();
    await page.getByTestId('composer.model').click();
    await expect(page.getByTestId('composer.model.menu')).toBeVisible();
    await shot(page, '1-输入框-模型档位');
    await page.getByTestId('composer.model.option:fast').click();
    await expect(page.getByTestId('composer.model')).toHaveText(/模型 · 快/);
    const req = page.waitForRequest((r) => r.url().endsWith('/messages') && r.method() === 'POST');
    await sendText(page, '快档');
    expect((await req).headers()['x-model-tier']).toBe('fast');
  });

  test('@ 引用列表：只列已解析材料，选两个后 document_ids 长度 2', async ({ page }) => {
    await openConversation(page);
    await textbox(page).fill('比较 @');
    const menu = page.getByTestId('composer.mention');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('composer.mention.item:doc_longmemeval')).toHaveCount(0);
    await shot(page, '2-艾特-文件引用列表');
    await textbox(page).press('Enter');
    await textbox(page).pressSequentially('和 @L05');
    await menu.getByTestId('composer.mention.item:doc_l05_attention').click();
    await expect(page.getByTestId('composer.scope')).toHaveText(/已选 2 个文件/);
    const req = page.waitForRequest((r) => r.url().endsWith('/messages') && r.method() === 'POST');
    await textbox(page).press('Enter');
    expect((await req).postDataJSON().scope.document_ids).toHaveLength(2);
  });

  test('/ Skill 列表：选中后成为小标签，请求带 forced_skill，步骤里出现加载 Skill', async ({ page }) => {
    await openConversation(page);
    await textbox(page).fill('/');
    const menu = page.getByTestId('composer.slash');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('composer.slash.item:pdf')).toBeVisible();
    await shot(page, '2-斜杠-Skill选择列表');
    await textbox(page).press('Enter');
    await expect(page.getByTestId('composer.skill-tag')).toHaveText('/pdf');
    const req = page.waitForRequest((r) => r.url().endsWith('/messages') && r.method() === 'POST');
    await textbox(page).pressSequentially('读一下表格');
    await textbox(page).press('Enter');
    expect((await req).postDataJSON().forced_skill).toBe('pdf');
    const trail = page.locator('[data-testid^="chat.step-trail:msg_m"]');
    await expect(page.locator('[data-testid^="chat.assistant-message:msg_m"]')).toHaveAttribute(
      'data-status',
      'saved',
      {
        timeout: 15_000,
      },
    );
    await trail.click();
    await expect(page.locator('[data-testid^="chat.step-trail.detail:"]').last()).toContainText('加载 Skill：pdf');
  });

  test('插件区入口：列出本对话插件，点击打开会话插件弹层（F6 挂载点）', async ({ page }) => {
    await openConversation(page);
    const entry = page.getByTestId('composer.plugin-entry');
    await expect(entry).toContainText('arXiv'); // F6b：改用简称（原 U36）
    await entry.click();
    await expect(entry).toHaveAttribute('aria-expanded', 'true');
    // F6b：本规格截图改由 f6b-plugins.spec.ts 生成（弹层已实现）
  });

  test('附件：上传到当前项目，小卡显示解析进度，同时出现在文件栏', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('composer.attach-input').setInputFiles({
      name: 'L06 位置编码.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%mock\n'),
    });
    const card = page.locator('[data-testid^="composer.attach-card:"]');
    await expect(card).toContainText('L06 位置编码.pdf');
    await expect(card).toContainText(/解析 \d+%/);
    await expect(page.getByTestId('composer.scope')).toHaveText(/已选 1 个文件/);
    await expect(page.getByTestId('files.list').getByText('L06 位置编码.pdf')).toBeVisible();
    await shot(page, '1-输入框-附件按钮');
  });

  test('文件行拖到输入框：加入 @ 引用（U23）', async ({ page }) => {
    await openConversation(page);
    await page.getByTestId('files.file-row:doc_attention').dragTo(textbox(page));
    await expect(textbox(page)).toHaveValue(/@Attention Is All You Need/);
    await expect(page.getByTestId('composer.scope')).toHaveText(/已选 1 个文件/);
  });

  test('草稿：切到别的对话再回来，草稿还在；新建对话后输入框获得焦点（U23）', async ({ page }) => {
    await openConversation(page);
    await textbox(page).fill('写了一半的问题');
    await page.getByTestId('sidebar.conversation-row:cnv_backprop_hw3').click();
    // U37：草稿按对话存，A 的半句不跟到 B
    await expect(textbox(page)).toHaveValue('');
    await page.getByTestId('sidebar.conversation-row:cnv_transformer').click();
    await expect(textbox(page)).toHaveValue('写了一半的问题');
    await page.getByTestId('sidebar.new-chat').click();
    await expect(page.getByTestId('home.onboard')).toBeVisible();
    await expect(textbox(page)).toBeFocused();
  });

  test('长文本最多 8 行后滚动；Shift+Enter 换行不发送', async ({ page }) => {
    await openConversation(page);
    const ta = textbox(page);
    await ta.click();
    for (let i = 0; i < 12; i += 1) {
      await ta.pressSequentially(`第 ${i + 1} 行`);
      await ta.press('Shift+Enter');
    }
    const h = await ta.evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeLessThanOrEqual(23 * 8 + 1);
    expect(await ta.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(page.locator('[data-testid^="chat.user-message:"]')).toHaveCount(2);
  });
});
