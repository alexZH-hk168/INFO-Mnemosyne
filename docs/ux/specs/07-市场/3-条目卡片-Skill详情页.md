# 3-条目卡片-Skill详情页

| 项 | 值 |
|---|---|
| ID / data-testid | `market.skill-detail` |
| 类型 | 窗口 |
| 级数 | 3 |
| 上级规格 | [2-市场页-条目卡片](2-市场页-条目卡片.md) |
| 概念图 | [UI-10](../../../assets/ui/10-skill-detail.png) |
| 建议组件 | `web/src/market/SkillDetail.tsx` |
| 里程碑 | F6（市场、插件、设置） |
| 规格状态 | 草案 v0.1，2026-11-22，待用户确认 |

左：SKILL.md 头部（name、description、license）与正文预览；右：安装/启用、加载方式说明（“系统提示只放名称和简介，需要时才读全文；输入 /pdf 强制加载”）、目录与附带文件、来源。

## 上一级：从哪里进来

| 入口 | 触发条件 | 传入的数据 / 接口 |
|---|---|---|
| 条目卡片 / 路由 `/market/skill/:id` | `marketRoute.detail.type==="skill"` | `id` |

其他指向本规格的规格：[2-条目卡片-安装按钮](2-条目卡片-安装按钮.md)。

## 下一级：去哪里

| 操作 | 结果 | 目标规格 | 调用的接口 / store action |
|---|---|---|---|
| 面包屑 | 回列表 | [2-插件与Skill-市场页](2-插件与Skill-市场页.md) | — |
| 安装按钮 | — | [2-条目卡片-安装按钮](2-条目卡片-安装按钮.md) | — |
| 启用开关（已安装） | 全局启用/停用 | — | PUT /api/skills/{id} `{enabled}` |

## 接口

| 类型 | 名称 | 何时调用 | 字段与说明 |
|---|---|---|---|
| query | `['skill', id]` | 打开（已安装） | GET /api/skills/{id} |
| query | `['market','skills']` | 未安装 | 正文预览取 registry 中缓存的 SKILL.md |

字段定义见 [REST](../../../contract/rest-api.md)、[SSE](../../../contract/sse-events.md)、[类型](../../../contract/types.ts)；query key 见 [state.md](../../../ux/state.md)。

## 读写的前端状态

- 无全局状态，只用组件内部 state。

## 状态

| 状态 | 表现 |
|---|---|
| 未安装 | 正文预览来自 registry 缓存 |
| 附带脚本 | 文件列表里脚本文件标“不执行” |

## 交互细则

- SKILL.md 正文用 Markdown 渲染，代码块高亮。

## 验收

- [ ] UI-10 复现。
- [ ] 所有可点元素带 `data-testid`，键盘可达，焦点可见。

## 待确认 / 缺口

- registry 是否缓存 SKILL.md 正文：契约未定义；不缓存则未安装时只显示简介。
