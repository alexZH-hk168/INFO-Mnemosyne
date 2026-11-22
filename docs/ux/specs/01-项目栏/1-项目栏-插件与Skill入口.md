# 1-项目栏-插件与Skill入口

| 项 | 值 |
|---|---|
| ID / data-testid | `sidebar.market-entry` |
| 类型 | 按钮 |
| 级数 | 1 |
| 上级规格 | [1-外壳-项目栏](1-外壳-项目栏.md) |
| 概念图 | [UI-07](../../../assets/ui/07-market-plugins.png) |
| 建议组件 | `web/src/project/MarketEntry.tsx` |
| 里程碑 | F6（市场、插件、设置） |
| 规格状态 | 草案 v0.1，2026-11-22，待用户确认 |

导航行“插件与 Skill”，右侧数字＝已安装插件数＋已启用 Skill 数。

## 上一级：从哪里进来

| 入口 | 触发条件 | 传入的数据 / 接口 |
|---|---|---|
| 项目栏 | 渲染 | 读 `['plugins']`、`['skills']` 计数 |

## 下一级：去哪里

| 操作 | 结果 | 目标规格 | 调用的接口 / store action |
|---|---|---|---|
| 点击 | 中间区切到市场页插件标签 | [2-插件与Skill-市场页](../07-市场/2-插件与Skill-市场页.md) | `useLayout.view="market"`、`marketRoute={tab:"plugins"}`、路由 `/market/plugins` |

## 接口

| 类型 | 名称 | 何时调用 | 字段与说明 |
|---|---|---|---|
| query | `['plugins'], ['skills']` | 挂载 | 只取数量 |

字段定义见 [REST](../../../contract/rest-api.md)、[SSE](../../../contract/sse-events.md)、[类型](../../../contract/types.ts)；query key 见 [state.md](../../../ux/state.md)。

## 读写的前端状态

- useLayout.view / marketRoute

## 状态

| 状态 | 表现 |
|---|---|
| 在市场页 | 行高亮 `--sel` |
| 数量为 0 | 不显示数字 |

## 验收

- [ ] 安装或卸载插件后数字即时更新（失效 query）。
- [ ] 所有可点元素带 `data-testid`，键盘可达，焦点可见。
