"""内置工具与插件工具的执行（任务第 2 条）：每次调用是一个步骤（tool_calls 一行 + 两个 step 事件），
返回的片段登记为候选证据 E1…Ek 并发 evidence 事件。

步骤文案写 tool_calls.label（契约 v0.4，U46）；参考历史对话的步骤只说“参考 N 段历史对话”，不出现“记忆”二字。
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from app.agent import hooks
from app.agent.citations import PoolItem
from app.agent.text import strip_markers
from app.branch.path import is_message_visible
from app.ids import new_id, now_iso, sha256_text
from app.llm.base import ToolCallReq, tool_schema
from app.repo import evidence_title
from app.retrieval.search import evidence_for_hit, hybrid_search
from app.web import fetch as webfetch
from app.web import search as websearch

if TYPE_CHECKING:
    from app.agent.loop import Turn

STEP_KINDS = {"search_materials", "search_web", "fetch_url", "recall_memory", "open_source", "plugin_tool", "load_skill"}
EVIDENCE_KINDS = {"material", "web", "message", "plugin"}
TOOL_TIMEOUT_S = 45.0
QUOTE_FOR_MODEL = 800


@dataclass
class Outcome:
    label: str
    text: str = ""
    evidence_ids: list[str] = field(default_factory=list)
    error: bool = False


def _clip(s: str, n: int) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------- 工具清单 ----------

async def tool_schemas(turn: "Turn") -> list[dict]:
    out: list[dict] = []
    if turn.scope.get("mode") != "none":
        out.append(tool_schema(
            "search_materials",
            "在用户上传的项目材料（论文、课件、代码、笔记）里检索与问题相关的段落。",
            {"type": "object", "properties": {"query": {"type": "string", "description": "检索语句"}}, "required": ["query"]},
        ))
    if turn.web_search and websearch.available():
        out.append(tool_schema(
            "search_web", "联网搜索，返回标题、网址和摘要；要引用网页内容请再用 fetch_url 抓取。",
            {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        ))
    if turn.web_search:
        out.append(tool_schema(
            "fetch_url", "抓取一个网页的正文并保存快照，返回与问题最相关的段落。",
            {"type": "object", "properties": {"url": {"type": "string"}, "query": {"type": "string", "description": "想在网页里找什么"}}, "required": ["url"]},
        ))
    if turn.memory_enabled:
        out.append(tool_schema(
            "recall_memory", "查找这位用户以前的对话里与问题相关的内容。",
            {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        ))
    out.append(tool_schema(
        "open_source", "按消息 id 打开一条历史对话消息的原文（只能打开当前分支路径上可见的消息）。",
        {"type": "object", "properties": {"message_id": {"type": "string"}}, "required": ["message_id"]},
    ))
    if turn.skills:
        out.append(tool_schema(
            "load_skill", "读取一个 Skill 的完整说明（SKILL.md）。",
            {"type": "object", "properties": {"skill_id": {"type": "string", "enum": [s["id"] for s in turn.skills]}}, "required": ["skill_id"]},
        ))
    try:
        specs = await hooks.get_plugins().list_tools(turn.conn, conversation_id=turn.conversation_id)
    except Exception:  # noqa: BLE001 - 插件清单失败不影响内置工具
        specs = []
    for spec in specs or []:
        turn.plugin_tools.add(spec.name)
        out.append(tool_schema(spec.name, spec.description or spec.name, spec.input_schema or {"type": "object", "properties": {}}))
    return out


# ---------- 证据 ----------

def insert_draft(turn: "Turn", d: hooks.EvidenceDraft) -> str | None:
    if d.kind not in EVIDENCE_KINDS or not d.source_id or not (d.quote or "").strip():
        return None
    eid = new_id("evd")
    captured = turn.assistant_message_id if d.kind in ("web", "plugin") else None
    turn.conn.execute(
        "INSERT INTO evidence (id, source_type, source_id, locator_json, quote, sha256, created_at, captured_in_message_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (eid, d.kind, d.source_id, json.dumps(d.locator or {}, ensure_ascii=False), d.quote, sha256_text(d.quote), now_iso(), captured),
    )
    turn.conn.commit()
    if d.title:
        turn.titles[eid] = d.title
    return eid


def register_evidence(turn: "Turn", eid: str) -> str | None:
    """把一条 evidence 行编入本轮证据池（E1…Ek）并发 evidence 事件；同一来源同一位置只编一次号。"""
    row = turn.conn.execute("SELECT * FROM evidence WHERE id = ?", (eid,)).fetchone()
    if row is None:
        return None
    key = (row["source_type"], row["source_id"], row["locator_json"])
    if key in turn.dedupe:
        return turn.dedupe[key]
    label = f"E{len(turn.pool) + 1}"
    turn.dedupe[key] = label
    turn.pool[label] = PoolItem(eid=eid, label=label, quote=row["quote"])
    title = turn.titles.get(eid) or evidence_title(turn.conn, row)
    turn.pool_titles[label] = title
    turn.em.emit("evidence", {
        "eid": eid,
        "label": label,
        "source_type": row["source_type"],
        "source_id": row["source_id"],
        "title": title,
        "locator": json.loads(row["locator_json"]),
        "quote": row["quote"],
        "sha256": row["sha256"],
    })
    return label


# ---------- 各工具 ----------

async def _search_materials(turn: "Turn", args: dict) -> Outcome:
    query = str(args.get("query") or turn.question)
    scope = dict(turn.scope)
    # 与回合共用同一个连接，所以同步执行（不放进线程，避免取消时两个线程同时用一个连接）
    hits = hybrid_search(turn.conn, turn.project_id, query, scope, 6)
    eids = [e for e in (evidence_for_hit(turn.conn, h, query) for h in hits) if e]
    docs = {h.document_id for h in hits}
    label = f"检索项目材料：{len(docs)} 份材料命中" if docs else "检索项目材料：没有命中"
    return Outcome(label, "" if eids else "项目材料里没有找到相关内容。", eids)


async def _search_web(turn: "Turn", args: dict) -> Outcome:
    query = str(args.get("query") or turn.question)
    try:
        results = await websearch.search(query)
    except websearch.SearchError as e:
        return Outcome(f"联网搜索：失败", str(e), error=True)
    lines = [f"{i}. {r.title}\n{r.url}\n{r.snippet}" for i, r in enumerate(results, 1)]
    text = "搜索结果（要引用请先用 fetch_url 抓取网页）：\n" + "\n\n".join(lines) if lines else "没有搜索结果。"
    return Outcome(f"联网搜索：{len(results)} 个结果", text)


async def _fetch_url(turn: "Turn", args: dict) -> Outcome:
    url = str(args.get("url") or "")
    host = urlparse(url).hostname or url
    try:
        snap = await webfetch.fetch_snapshot(turn.conn, project_id=turn.project_id, url=url)
    except webfetch.FetchError as e:
        return Outcome(f"抓取网页：{host}（失败）", f"抓取失败：{e}", error=True)
    eids = []
    for s, e in webfetch.pick_passages(snap.text, str(args.get("query") or turn.question)):
        eid = insert_draft(turn, hooks.EvidenceDraft(
            kind="web", source_id=snap.id, quote=snap.text[s:e],
            locator={"snapshot_id": snap.id, "char_range": [s, e]}, title=snap.title,
        ))
        if eid:
            eids.append(eid)
    return Outcome(f"抓取网页：{urlparse(snap.url).hostname or host}", f"已保存网页快照《{snap.title}》。", eids)


async def _recall_memory(turn: "Turn", args: dict) -> Outcome:
    query = str(args.get("query") or turn.question)
    drafts = hooks.get_memory().recall(
        turn.conn, project_id=turn.project_id, conversation_id=turn.conversation_id,
        leaf_message_id=turn.user_message_id, query=query, k=8,
    ) or []
    eids = [e for e in (insert_draft(turn, d) for d in drafts) if e]
    n = len({d.source_id for d in drafts if d.source_id})
    label = f"参考 {n} 段历史对话" if n else "没有找到相关的历史对话"
    return Outcome(label, "" if eids else "没有找到相关的历史对话。", eids)


async def _open_source(turn: "Turn", args: dict) -> Outcome:
    mid = str(args.get("message_id") or "")
    row = turn.conn.execute(
        "SELECT m.*, c.title AS ctitle FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?", (mid,)
    ).fetchone()
    if row is None:
        return Outcome("查看历史对话：消息不存在", "消息不存在。", error=True)
    if not is_message_visible(turn.conn, mid, turn.user_message_id):
        return Outcome("查看历史对话：不在当前分支路径上", "NOT_VISIBLE_ON_PATH：这条消息不在当前分支路径上，不能打开。", error=True)
    plain, _ = strip_markers(row["content"])
    quote = plain[:QUOTE_FOR_MODEL]
    title = row["ctitle"] or "历史对话"
    eid = insert_draft(turn, hooks.EvidenceDraft(
        kind="message", source_id=mid, quote=quote, locator={"message_id": mid, "char_range": [0, len(quote)]}, title=title,
    ))
    return Outcome(f"查看历史对话：{_clip(title, 20)}", "", [eid] if eid else [], error=eid is None)


async def _load_skill(turn: "Turn", args: dict) -> Outcome:
    sid = str(args.get("skill_id") or "")
    text = hooks.get_skills().load(turn.conn, skill_id=sid) or ""
    if not text.strip():
        return Outcome(f"加载 Skill：{sid}（失败）", f"没有名为 {sid} 的可用 Skill。", error=True)
    return Outcome(f"加载 Skill：{sid}", text[:12000])


async def _plugin(turn: "Turn", name: str, args: dict) -> Outcome:
    res = await hooks.get_plugins().call_tool(turn.conn, conversation_id=turn.conversation_id, name=name, arguments=args, timeout_s=30.0)
    eids = [e for e in (insert_draft(turn, d) for d in (res.evidence or [])) if e]
    base = plugin_label(turn.conn, name)
    return Outcome(base + ("（失败）" if res.is_error else ""), res.text or "", eids, error=bool(res.is_error))


def plugin_label(conn: sqlite3.Connection, name: str) -> str:
    pid, _, tool = name.partition("__")
    row = conn.execute("SELECT name FROM plugins WHERE id = ?", (pid,)).fetchone()
    return f"{row['name'] if row else pid} · {tool or name}"


def running_label(turn: "Turn", name: str, args: dict) -> str:
    if name == "search_materials":
        return "检索项目材料"
    if name == "search_web":
        return f"联网搜索：{_clip(args.get('query') or turn.question, 20)}"
    if name == "fetch_url":
        return f"抓取网页：{urlparse(str(args.get('url') or '')).hostname or _clip(args.get('url') or '', 30)}"
    if name == "recall_memory":
        return "参考历史对话"
    if name == "open_source":
        return "查看历史对话"
    if name == "load_skill":
        return f"加载 Skill：{args.get('skill_id') or ''}"
    return plugin_label(turn.conn, name)


async def _dispatch(turn: "Turn", name: str, args: dict) -> Outcome:
    if name == "search_materials" and turn.scope.get("mode") != "none":
        return await _search_materials(turn, args)
    if name == "search_web" and turn.web_search and websearch.available():
        return await _search_web(turn, args)
    if name == "fetch_url" and turn.web_search:
        return await _fetch_url(turn, args)
    if name == "recall_memory" and turn.memory_enabled:
        return await _recall_memory(turn, args)
    if name == "open_source":
        return await _open_source(turn, args)
    if name == "load_skill":
        return await _load_skill(turn, args)
    if name in turn.plugin_tools:
        return await _plugin(turn, name, args)
    return Outcome(f"{name}（不可用）", f"工具 {name} 在这一轮不可用。", error=True)


# ---------- 步骤 ----------

def _start_step(turn: "Turn", name: str, label: str, args: dict) -> str:
    step_id = new_id("stp")
    turn.step_index += 1
    turn.conn.execute(
        "INSERT INTO tool_calls (id, message_id, step_index, tool_name, label, args_json, result_json, status, duration_ms) "
        "VALUES (?, ?, ?, ?, ?, ?, NULL, 'running', NULL)",
        (step_id, turn.assistant_message_id, turn.step_index, name, label, json.dumps(args, ensure_ascii=False)),
    )
    turn.conn.commit()
    turn.em.emit("step", {"step_id": step_id, "kind": name if name in STEP_KINDS else "plugin_tool", "label": label, "status": "running"})
    return step_id


def _finish_step(turn: "Turn", step_id: str, name: str, label: str, status: str, ms: int, result: dict) -> None:
    turn.conn.execute(
        "UPDATE tool_calls SET label = ?, status = ?, duration_ms = ?, result_json = ? WHERE id = ?",
        (label, status, ms, json.dumps(result, ensure_ascii=False), step_id),
    )
    turn.conn.commit()
    turn.em.emit("step", {
        "step_id": step_id, "kind": name if name in STEP_KINDS else "plugin_tool", "label": label, "status": status, "duration_ms": ms,
    })


async def run_tool(turn: "Turn", call: ToolCallReq) -> str:
    name, args = call.name, dict(call.arguments or {})
    if name == "search_materials":
        args.setdefault("query", turn.question)
        args["scope"] = turn.scope  # 记下本轮范围，重新生成时沿用（U74）
    label = running_label(turn, name, args)
    step_id = _start_step(turn, name, label, args)
    t0 = time.monotonic()
    try:
        out = await asyncio.wait_for(_dispatch(turn, name, args), timeout=TOOL_TIMEOUT_S)
    except asyncio.TimeoutError:
        out = Outcome(f"{label}（超时）", "工具调用超时。", error=True)
    except asyncio.CancelledError:
        _finish_step(turn, step_id, name, f"{label}（已停止）", "error", int((time.monotonic() - t0) * 1000), {"cancelled": True})
        raise
    except Exception as e:  # noqa: BLE001 - 单个工具失败不让整轮失败
        out = Outcome(f"{label}（失败）", f"工具出错：{type(e).__name__}", error=True)
    ms = int((time.monotonic() - t0) * 1000)
    _finish_step(turn, step_id, name, out.label, "error" if out.error else "done", ms,
                 {"evidence_ids": out.evidence_ids, "text": out.text[:2000]})
    blocks = []
    for eid in out.evidence_ids:
        lab = register_evidence(turn, eid)
        if lab:
            blocks.append(f"[[{lab}]] 《{turn.pool_titles[lab]}》\n{turn.pool[lab].quote[:QUOTE_FOR_MODEL]}")
    text = out.text.strip()
    if blocks:
        text = (text + "\n\n" if text else "") + "\n\n".join(blocks)
    return text or "（没有内容）"

