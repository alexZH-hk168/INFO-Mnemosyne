# 证据单元与定位符

所有来源统一成证据单元，回答只能引用本轮候选证据池中的条目。

```json
{
  "id": "evd_01J…",
  "label": "E3",
  "source_type": "material",
  "source_id": "doc_01J…",
  "title": "Attention Is All You Need",
  "locator": { "page": 4, "sentence_ids": ["s4_112"], "bbox": [72.0, 540.2, 523.8, 566.1] },
  "quote": "We suspect that for large values of d_k, the dot products grow large in magnitude…",
  "sha256": "…"
}
```

`label` 只在本轮有效；持久引用用 `id`。SSE `evidence` 事件里的 `eid` 就是这里的 `id`。

偏移约定（v0.2）：下表的 `char_range` 一律左闭右开、按 Unicode 码点计数；`lines` 是从 1 开始的闭区间行号。详见 [README 第 7 条](./README.md#规则)。

## locator 约定

| source_type / kind | locator | 右栏如何定位 |
|---|---|---|
| material / pdf | `{page, sentence_ids, bbox}`；`page` 从 1 开始；`bbox` 为 PDF 坐标系 `[x0, y0, x1, y1]`（原点左上，单位 pt，PyMuPDF 默认） | 跳到页，高亮 bbox；bbox 不准时退回高亮所在文字块 |
| material / pptx | `{slide, shape_id, char_range}` | 跳到对应页（预览是转换后的 PDF，第 slide 页） |
| material / code | `{path, lines: [start, end]}`，行号从 1 开始，闭区间 | 滚到行并高亮 |
| material / ipynb | `{path, cell, lines}`；`cell` 从 0 开始，`lines` 是单元格内行号 | 滚到单元格并高亮行；输出单元格不参与检索 |
| material / md | `{path, lines}` | 同代码 |
| web | `{snapshot_id, char_range: [start, end]}` | 打开快照，高亮字符区间；顶部显示原 URL 与抓取时间 |
| message | `{message_id, char_range}` | 在右栏以只读方式显示那段原始对话 |
| plugin（有 URL） | 按 web 处理：抓取快照后 `source_type` 记为 web | 同 web |
| plugin（无 URL） | `{plugin_id, tool_name, fields}` | 右栏只读卡片显示原始字段 |

## 胶囊配色

| 来源 | 背景 | 文字 |
|---|---|---|
| 用户材料 | `#f4ecda` | `#8a5b14` |
| 网页、插件 | `#e9eef3` | `#3f5f7f` |
| 历史对话 | `#eeece8` | `#6b675f` |

待确认状态（只收到 `delta` 未收到 `citation`）：同色、1px 虚线边框、60% 不透明度。选中态：外圈 `0 0 0 2px #e2c47a`。

## 引用校验三关

1. 存在性：`E#` 必须在本轮证据池。
2. 词面重叠：回答句与 `quote` 的字符二元组重叠率，低于 0.05 直接判 removed；其余记录到 `citations.overlap`。
3. 支持度：小模型判定 supported / partial / removed，同一回答的多条引用合并为一次调用。

阈值在 dev 集上调，改动记入进度文档。

v0.5 草案（[B2]，U71）的实现细节：第二关的重叠率＝回答句（去掉 `[[E#]]`、去空白、小写）的字符二元组中出现在 `quote` 里的比例，以回答句为分母；回答句与 `quote` 一中一外（一方汉字占比 ≥ 30%、另一方 < 10%）时字符二元组无法衡量，第二关不剔除，交第三关判定；第三关调用失败或输出无法解析时，剩余引用一律 `partial`。同一句里重复出现的同一个 `E#` 只算一条引用。
