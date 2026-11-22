# 2-证据胶囊-PDF预览

| 项 | 值 |
|---|---|
| ID / data-testid | `right.pdf-preview` |
| 类型 | 窗口 |
| 级数 | 2 |
| 上级规格 | [1-外壳-右栏](1-外壳-右栏.md) |
| 概念图 | [UI-06](../../../assets/ui/06-workspace-evidence.png) |
| 建议组件 | `web/src/preview/PdfViewer.tsx` |
| 里程碑 | F4（右栏预览） |
| 规格状态 | 草案 v0.1，2026-11-22，待用户确认 |

pdf.js 渲染（文本层＋高亮层），工具条：页码、缩放、页内查找、下载。由证据打开时跳到页并高亮 bbox。

## 上一级：从哪里进来

| 入口 | 触发条件 | 传入的数据 / 接口 |
|---|---|---|
| 证据胶囊 / 来源列表 / 文件行 | tab kind=pdf | `ref_id=document_id`，可选 `locator` |

其他指向本规格的规格：[1-文件分组-文件行](../02-文件栏/1-文件分组-文件行.md)、[1-助手回答-证据胶囊](../05-对话栏/1-助手回答-证据胶囊.md)。

## 下一级：去哪里

| 操作 | 结果 | 目标规格 | 调用的接口 / store action |
|---|---|---|---|
| 工具条 | — | [2-PDF预览-工具条](2-PDF预览-工具条.md) | — |

## 接口

| 类型 | 名称 | 何时调用 | 字段与说明 |
|---|---|---|---|
| REST | `GET /api/documents/{did}/raw` | 打开 | PDF 二进制 |

字段定义见 [REST](../../../contract/rest-api.md)、[SSE](../../../contract/sse-events.md)、[类型](../../../contract/types.ts)；query key 见 [state.md](../../../ux/state.md)。

## 读写的前端状态

- useEvidence.selectedEvidenceId

## 状态

| 状态 | 表现 |
|---|---|
| 加载中 | 页面骨架 |
| 有 locator | 滚到 page，bbox 区域 `#fbe8a6` 高亮，右侧外挂“证据 N”标签（不压正文） |
| bbox 缺失或越界 | 退回高亮所在文字块 |

## 交互细则

- 只读：不提供批注、编辑。
- “证据 N”标签放在页边距外侧（UI-06 修正后的位置）。

## 验收

- [ ] UI-06 场景复现：第 4 页脚注 4 高亮。
- [ ] 所有可点元素带 `data-testid`，键盘可达，焦点可见。
