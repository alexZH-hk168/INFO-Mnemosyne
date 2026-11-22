# 2-市场页-导入Skill

| 项 | 值 |
|---|---|
| ID / data-testid | `market.import-skill` |
| 类型 | 按钮 |
| 级数 | 2 |
| 上级规格 | [2-插件与Skill-市场页](2-插件与Skill-市场页.md) |
| 概念图 | 无（实现前需补概念图或实现后截图确认） |
| 建议组件 | `web/src/market/ImportSkillDialog.tsx` |
| 里程碑 | F6（市场、插件、设置） |
| 规格状态 | 草案 v0.1，2026-11-22，待用户确认 |

Skill 市场标签右上“导入”：填 GitHub 目录地址或本机路径，导入自定义 Skill。

## 上一级：从哪里进来

| 入口 | 触发条件 | 传入的数据 / 接口 |
|---|---|---|
| 市场页 Skill 标签 | 渲染 | — |

## 下一级：去哪里

| 操作 | 结果 | 目标规格 | 调用的接口 / store action |
|---|---|---|---|
| 导入 | 校验 SKILL.md 后加入已安装 | — | POST /api/skills/import `{source, url\|path}`；失效 `['skills']` |

## 接口

| 类型 | 名称 | 何时调用 | 字段与说明 |
|---|---|---|---|
| REST | `POST /api/skills/import` | 提交 | `SKILL_INVALID` 显示缺哪个字段 |

字段定义见 [REST](../../../contract/rest-api.md)、[SSE](../../../contract/sse-events.md)、[类型](../../../contract/types.ts)；query key 见 [state.md](../../../ux/state.md)。

## 读写的前端状态

- 无全局状态，只用组件内部 state。

## 状态

| 状态 | 表现 |
|---|---|
| 校验失败 | 输入框下红字 |

## 验收

- [ ] 导入 anthropics/skills 的 pdf 目录成功。
- [ ] 所有可点元素带 `data-testid`，键盘可达，焦点可见。

## 待确认 / 缺口

- 无概念图。
