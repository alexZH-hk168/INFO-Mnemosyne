"""数据库行 → 契约对象的转换（只读查询集中在这里，接口文件只管路由与校验）。"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from app import models as m
from app.branch.path import path_to_root
from app.ingest.pipeline import latest_progress

STEP_KINDS = {"search_materials", "search_web", "fetch_url", "recall_memory", "open_source", "plugin_tool", "load_skill"}
_STEP_STATUS = {"running": "running", "done": "done", "ok": "done", "error": "error", "failed": "error"}
_TITLE_SUFFIXES = {".pdf", ".pptx", ".md", ".markdown", ".ipynb"}

_line_cache: dict[tuple[str, float], int] = {}


def _loads(text: str | None, default):
    if not text:
        return default
    try:
        return json.loads(text)
    except ValueError:
        return default


# ---------- 项目与对话 ----------

def project_out(conn: sqlite3.Connection, row: sqlite3.Row) -> m.Project:
    count = conn.execute("SELECT COUNT(*) FROM conversations WHERE project_id = ?", (row["id"],)).fetchone()[0]
    return m.Project(id=row["id"], name=row["name"], created_at=row["created_at"], conversation_count=count)


def conversation_out(row: sqlite3.Row) -> m.Conversation:
    return m.Conversation(
        id=row["id"],
        project_id=row["project_id"],
        title=row["title"] or "",
        root_message_id=row["root_message_id"],
        active_leaf_id=row["active_leaf_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def branch_count(conn: sqlite3.Connection, cid: str) -> int:
    """对话列表上的分支数：不计已归档的分支。"""
    return conn.execute(
        "SELECT COUNT(*) FROM branches WHERE conversation_id = ? AND status != 'archived'", (cid,)
    ).fetchone()[0]


def step_out(row: sqlite3.Row) -> m.Step:
    args = _loads(row["args_json"], {})
    result = _loads(row["result_json"], {})
    kind = row["tool_name"] if row["tool_name"] in STEP_KINDS else "plugin_tool"
    label = (isinstance(args, dict) and args.get("label")) or (isinstance(result, dict) and result.get("label")) or row["tool_name"]
    return m.Step(
        step_id=row["id"],
        kind=kind,
        label=str(label),
        status=_STEP_STATUS.get(row["status"] or "done", "done"),
        duration_ms=row["duration_ms"],
    )


def message_out(conn: sqlite3.Connection, row: sqlite3.Row) -> m.Message:
    usage = _loads(row["usage_json"], None)
    msg = m.Message(
        id=row["id"],
        conversation_id=row["conversation_id"],
        parent_id=row["parent_id"],
        branch_id=row["branch_id"],
        role=row["role"],
        content=row["content"],
        model=row["model"],
        usage=m.Usage(**usage) if isinstance(usage, dict) else None,
        created_at=row["created_at"],
    )
    if row["role"] == "assistant":
        msg.steps = [
            step_out(r)
            for r in conn.execute("SELECT * FROM tool_calls WHERE message_id = ? ORDER BY step_index", (row["id"],))
        ]
        msg.citations = [
            m.Citation(
                citation_id=r["id"],
                eid=r["evidence_id"],
                label=r["label"],
                sentence_start=r["sentence_start"],
                sentence_end=r["sentence_end"],
                verdict=r["verdict"],
            )
            for r in conn.execute("SELECT * FROM citations WHERE message_id = ? ORDER BY sentence_start, rowid", (row["id"],))
        ]
    return msg


def branch_out(conn: sqlite3.Connection, row: sqlite3.Row) -> m.Branch:
    # context_turns：分支能看到的主线轮数＝根到 fork 消息（含）之间主线用户消息数
    path = path_to_root(conn, row["fork_message_id"])
    turns = 0
    if path:
        qs = ",".join("?" * len(path))
        turns = conn.execute(
            f"SELECT COUNT(*) FROM messages WHERE id IN ({qs}) AND role = 'user' AND branch_id IS NULL", path
        ).fetchone()[0]
    return m.Branch(
        id=row["id"],
        conversation_id=row["conversation_id"],
        fork_message_id=row["fork_message_id"],
        anchor_start=row["anchor_start"],
        anchor_end=row["anchor_end"],
        anchor_quote=row["anchor_quote"],
        title=row["title"],
        status=row["status"],
        merged_into_message_id=row["merged_into_message_id"],
        created_at=row["created_at"],
        context_turns=turns,
    )


# ---------- 材料 ----------

def count_lines(path: str | None) -> int | None:
    if not path or not os.path.exists(path):
        return None
    key = (path, os.path.getmtime(path))
    if key not in _line_cache:
        with open(path, "rb") as f:
            data = f.read()
        text = data.decode("utf-8", errors="replace")
        _line_cache[key] = len(text.splitlines())
    return _line_cache[key]


def cited_count(conn: sqlite3.Connection, doc: sqlite3.Row) -> int:
    if doc["kind"] == "web":
        st, sid = "web", doc["snapshot_id"]
    else:
        st, sid = "material", doc["id"]
    if not sid:
        return 0
    return conn.execute(
        "SELECT COUNT(*) FROM citations c JOIN evidence e ON e.id = c.evidence_id "
        "WHERE e.source_type = ? AND e.source_id = ? AND c.verdict != 'removed'",
        (st, sid),
    ).fetchone()[0]


def document_out(conn: sqlite3.Connection, row: sqlite3.Row) -> m.Document:
    status = row["parse_status"]
    if status == "ready":
        progress = 100
    else:
        progress = latest_progress(conn, row["id"]) or 0
        if status == "queued":
            progress = 0
    kind = row["kind"]
    return m.Document(
        id=row["id"],
        project_id=row["project_id"],
        kind=kind,
        group=row["group"],
        title=row["title"],
        pages=row["pages"] if kind in ("pdf", "pptx") else None,
        lines=count_lines(row["path"]) if kind in ("code", "md") else None,
        cells=row["cells"] if kind == "ipynb" else None,
        snapshot_id=row["snapshot_id"] if kind == "web" else None,
        parse_status=status,
        progress=progress,
        parse_error=row["parse_error"] if status == "failed" else None,
        cited_count=cited_count(conn, row),
        created_at=row["created_at"],
    )


# ---------- 证据 ----------

def evidence_title(conn: sqlite3.Connection, ev: sqlite3.Row) -> str:
    st, sid = ev["source_type"], ev["source_id"]
    if st == "material":
        row = conn.execute("SELECT title FROM documents WHERE id = ?", (sid,)).fetchone()
        if row is None:
            return sid
        title = row["title"]
        p = Path(title)
        return p.stem if p.suffix.lower() in _TITLE_SUFFIXES else title
    if st == "web":
        row = conn.execute("SELECT title, url FROM web_snapshots WHERE id = ?", (sid,)).fetchone()
        return (row["title"] or row["url"]) if row else sid
    if st == "message":
        row = conn.execute(
            "SELECT c.title FROM messages msg JOIN conversations c ON c.id = msg.conversation_id WHERE msg.id = ?", (sid,)
        ).fetchone()
        return (row["title"] or "历史对话") if row else "历史对话"
    loc = _loads(ev["locator_json"], {})
    row = conn.execute("SELECT name FROM plugins WHERE id = ?", (loc.get("plugin_id", sid),)).fetchone()
    name = row["name"] if row else loc.get("plugin_id", sid)
    return f"{name} · {loc['tool_name']}" if loc.get("tool_name") else name


def cited_by(conn: sqlite3.Connection, eid: str) -> list[m.CitedBy]:
    return [
        m.CitedBy(message_id=r["message_id"], label=r["label"])
        for r in conn.execute(
            "SELECT c.message_id, c.label FROM citations c JOIN messages msg ON msg.id = c.message_id "
            "WHERE c.evidence_id = ? ORDER BY msg.created_at, c.rowid",
            (eid,),
        )
    ]
