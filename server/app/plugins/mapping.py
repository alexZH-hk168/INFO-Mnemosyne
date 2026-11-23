"""工具结果 → 候选证据（EvidenceDraft），按插件适配清单的 `evidence_mapping`。

evidence_mapping 写法（契约 plugin-manifest.md 写“工具结果 → 证据字段的 JSON 路径”，下面是 B3b 的具体约定，
记在契约 v0.5 草案 [B3b]）：

- 键：`title`、`url`、`quote`（必需才能产生证据），可选 `items`。
- 值：一个路径字符串，或路径数组（依次取第一个非空值）。
- 路径：`$` 是当前记录；`$.a.b`、`$.a[0].b` 逐级取；`$args.x` 取本次调用参数；`$text` 取工具返回的全部文本。
- 模板：含 `{$…}` 的字符串按模板拼接，如 `"arXiv:{$.paper_id} · {$.title}"`；任一占位取不到值时整条模板视为空，
  接着试数组里的下一项（F6b 对齐：arXiv 证据标题写成“arXiv:编号 · 题名”）。
- `items`：结果里记录列表的路径（如 arXiv 的 `$.papers`），每条记录各产生一条证据；省略或该路径取不到数组时，
  整个结果是一条记录（结果本身是数组则每个元素一条）。
- 结果先取 MCP 的 structuredContent（SDK 把纯字符串返回包成 `{"result": "…"}` 的除外），否则把文本当 JSON 解析；
  都不是 JSON 时只有 `$text` / `$args` 可用。

证据类型（evidence-locator.md）：
- 记录有 http(s) URL → 写一条 web_snapshots（text = 标题 + 空行 + 引文全文），证据 kind=web，
  locator = {snapshot_id, char_range}（码点、左闭右开，指向引文在快照里的位置）。快照内容来自插件返回，
  不是 Mnemosyne 另外抓取的页面；http_status 记 200（插件调用成功）。
- 没有 URL → kind=plugin，locator = {plugin_id, tool_name, fields}，fields 是记录的原始字段：字符串截断到 2000 字，
  数字/布尔/空值与“标量数组”（如作者列表）原样保留，其余嵌套结构转成 JSON 文本。
- 插件证据的标题不入库：`GET /api/evidence/{eid}` 用 `title_from_locator()` 对 fields 重新套一次清单的 title
  映射（`$args` 占位此时取不到，跳到下一项），与回合里 SSE `evidence` 事件的标题一致。
"""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from app.agent.hooks import EvidenceDraft
from app.ids import new_id, now_iso, sha256_text

MAX_RECORDS = 5
MAX_QUOTE = 2000
MAX_FIELD = 2000
MAX_LIST = 50
_TOKEN = re.compile(r"\.([A-Za-z_][\w-]*)|\[(\d+)\]")
_PLACEHOLDER = re.compile(r"\{(\$[^{}]*)\}")


def parse_result(text: str, structured: Any) -> Any:
    if isinstance(structured, dict) and not (set(structured) == {"result"} and isinstance(structured.get("result"), str)):
        return structured
    if isinstance(structured, list):
        return structured
    raw = structured["result"] if isinstance(structured, dict) else text
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def get_path(path: str, record: Any, args: dict, text: str) -> Any:
    if path == "$text":
        return text
    if path.startswith("$args"):
        root: Any = args
        rest = path[len("$args"):]
    elif path.startswith("$"):
        root = record
        rest = path[1:]
    else:
        return None
    pos = 0
    cur = root
    while pos < len(rest):
        m = _TOKEN.match(rest, pos)
        if not m:
            return None
        if m.group(1) is not None:
            cur = cur.get(m.group(1)) if isinstance(cur, dict) else None
        else:
            idx = int(m.group(2))
            cur = cur[idx] if isinstance(cur, list) and idx < len(cur) else None
        if cur is None:
            return None
        pos = m.end()
    return cur


def pick(spec: Any, record: Any, args: dict, text: str) -> Any:
    paths = spec if isinstance(spec, list) else [spec]
    for p in paths:
        if not isinstance(p, str):
            continue
        if _PLACEHOLDER.search(p):
            v = _render(p, record, args, text)
            if v:
                return v
            continue
        v = get_path(p, record, args, text)
        if v not in (None, "", [], {}):
            return v
    return None


def _render(template: str, record: Any, args: dict, text: str) -> str:
    missing = False

    def sub(m: re.Match) -> str:
        nonlocal missing
        v = _as_text(get_path(m.group(1), record, args, text))
        if not v:
            missing = True
        return v

    out = _PLACEHOLDER.sub(sub, template)
    return "" if missing else out


def _as_text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, list) and all(isinstance(x, str) for x in v):
        return ", ".join(v)
    return json.dumps(v, ensure_ascii=False)


def _fields(record: Any) -> dict:
    if not isinstance(record, dict):
        return {"value": _as_text(record)[:MAX_FIELD]}
    out = {}
    for k, v in list(record.items())[:30]:
        if isinstance(v, (str, int, float, bool)) or v is None:
            out[str(k)] = v if not isinstance(v, str) else v[:MAX_FIELD]
        elif isinstance(v, list) and all(isinstance(x, (str, int, float, bool)) or x is None for x in v):
            out[str(k)] = [x[:MAX_FIELD] if isinstance(x, str) else x for x in v[:MAX_LIST]]
        else:
            out[str(k)] = _as_text(v)[:MAX_FIELD]
    return out


def records_of(mapping: dict, parsed: Any, args: dict, text: str) -> list[Any]:
    if "items" in mapping:
        items = pick(mapping["items"], parsed, args, text)
        if isinstance(items, list):
            return list(items)
        # 同一插件的其他工具可能只返回单条记录（如 arXiv 的 get_abstract）：整个结果当一条
    if isinstance(parsed, list):
        return parsed
    return [parsed]


def to_evidence(
    conn: sqlite3.Connection,
    *,
    plugin_id: str,
    plugin_name: str,
    tool_name: str,
    mapping: dict | None,
    arguments: dict,
    text: str,
    structured: Any,
) -> list[EvidenceDraft]:
    if not mapping:
        return []
    parsed = parse_result(text, structured)
    drafts: list[EvidenceDraft] = []
    for record in records_of(mapping, parsed, arguments, text)[:MAX_RECORDS]:
        quote_full = _as_text(pick(mapping.get("quote"), record, arguments, text))
        if not quote_full:
            continue
        title = _as_text(pick(mapping.get("title"), record, arguments, text)) or f"{plugin_name} · {tool_name}"
        url = _as_text(pick(mapping.get("url"), record, arguments, text))
        quote = quote_full[:MAX_QUOTE]
        if url.startswith(("http://", "https://")):
            snap_text = f"{title}\n\n{quote_full}"
            start = len(title) + 2
            sid = new_id("ws")
            conn.execute(
                "INSERT INTO web_snapshots (id, url, title, fetched_at, text, sha256, http_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sid, url, title, now_iso(), snap_text, sha256_text(snap_text), 200),
            )
            drafts.append(
                EvidenceDraft(
                    kind="web", source_id=sid, quote=quote, title=title,
                    locator={"snapshot_id": sid, "char_range": [start, start + len(quote)]},
                )
            )
        else:
            fields = _fields(record)
            if url and "url" not in fields:
                fields["url"] = url
            drafts.append(
                EvidenceDraft(
                    kind="plugin", source_id=plugin_id, quote=quote, title=title,
                    locator={"plugin_id": plugin_id, "tool_name": tool_name, "fields": fields},
                )
            )
    if drafts:
        conn.commit()
    return drafts


def title_from_locator(manifest: dict | None, locator: dict) -> str | None:
    """插件证据（无 URL）的标题：对 locator.fields 重新套清单的 title 映射；取不到返回 None。"""
    mapping = (manifest or {}).get("evidence_mapping") or {}
    fields = locator.get("fields")
    if not mapping.get("title") or not isinstance(fields, dict):
        return None
    title = _as_text(pick(mapping["title"], fields, {}, ""))
    return title or None
