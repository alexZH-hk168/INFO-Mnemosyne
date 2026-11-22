# 2-斜杠-Skill选择列表

| 项 | 值 |
|---|---|
| ID / data-testid | `composer.slash` |
| 类型 | 弹层 |
| 级数 | 2 |
| 上级规格 | [1-外壳-输入框](1-外壳-输入框.md) |
| 概念图 | [UI-11](../../../assets/ui/11-plugin-popover.png) |
| 建议组件 | `web/src/chat/SlashMenu.tsx` |
| 里程碑 | F6（市场、插件、设置） |
| 规格状态 | 草案 v0.1，2026-11-22，待用户确认 |

在输入框行首键入 “/” 弹出已启用 Skill 列表（与插件弹层下半部同一数据）。选中后本轮强制加载该 Skill。

## 上一级：从哪里进来

| 入口 | 触发条件 | 传入的数据 / 接口 |
|---|---|---|
| 输入框 | 行首输入 “/” | 读 `['skills']`（enabled） |

其他指向本规格的规格：[2-插件区-会话插件弹层](../07-市场/2-插件区-会话插件弹层.md)。

## 下一级：去哪里

| 操作 | 结果 | 目标规格 | 调用的接口 / store action |
|---|---|---|---|
| ↑↓ 选择，Enter / 点击确认 | 文本框里变成不可拆的 `/pdf` 小标签 | — | `composer.forced_skill = name` |
| 继续输入 | 按名称前缀过滤 | — | — |
| Esc / 删除 “/” | 关闭 | — | `useUI.popover=null` |

## 接口

| 类型 | 名称 | 何时调用 | 字段与说明 |
|---|---|---|---|
| query | `['skills']` | 打开 | 只列 enabled |

字段定义见 [REST](../../../contract/rest-api.md)、[SSE](../../../contract/sse-events.md)、[类型](../../../contract/types.ts)；query key 见 [state.md](../../../ux/state.md)。

## 读写的前端状态

- useChat.composer.forced_skill
- useUI.popover="slash"

## 状态

| 状态 | 表现 |
|---|---|
| 无匹配 | “没有匹配的 Skill · 去 Skill 市场” |
| 无已启用 Skill | 同上 |

## 交互细则

- 每轮最多强制一个 Skill；再选会替换。

## 验收

- [ ] 发送请求体带 `forced_skill`；SSE 出现 `kind=load_skill` 的步骤（MSW 模拟）。
- [ ] 所有可点元素带 `data-testid`，键盘可达，焦点可见。
