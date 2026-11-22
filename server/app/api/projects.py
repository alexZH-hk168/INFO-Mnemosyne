"""项目与对话（rest-api.md“项目与对话”；发消息属于 B2，不在此）。"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Query

from app import models as m
from app.api.deps import get_conn
from app.branch.path import path_to_root
from app.errors import ApiError, not_found
from app.ids import new_id, now_iso
from app.repo import branch_count, branch_out, conversation_out, message_out, project_out

router = APIRouter()

DEFAULT_CONVERSATION_TITLE = "新对话"  # 与 fixture post-projects-pid-conversations.ok.json 一致；B2 在首条消息后改写标题（U21）


def _project_or_404(conn: sqlite3.Connection, pid: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if row is None:
        raise not_found("项目")
    return row


def _conversation_or_404(conn: sqlite3.Connection, cid: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM conversations WHERE id = ?", (cid,)).fetchone()
    if row is None:
        raise not_found("对话")
    return row


@router.get("/projects")
def list_projects(conn: sqlite3.Connection = Depends(get_conn)):
    try:
        rows = conn.execute("SELECT * FROM projects ORDER BY created_at, rowid").fetchall()
        projects = [project_out(conn, r) for r in rows]
    except sqlite3.Error as e:
        raise ApiError("INTERNAL", "读取项目列表失败，请稍后重试") from e
    return m.dump(m.ProjectList(projects=projects))


@router.post("/projects")
def create_project(body: m.CreateProjectBody, conn: sqlite3.Connection = Depends(get_conn)):
    name = body.name.strip()
    if not 1 <= len(name) <= 60:
        raise ApiError("VALIDATION_ERROR", "项目名需为 1–60 个字")
    pid = new_id("prj")
    conn.execute("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)", (pid, name, now_iso()))
    conn.commit()
    return m.dump(project_out(conn, conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()))


@router.get("/projects/{pid}/conversations")
def list_conversations(
    pid: str,
    cursor: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    conn: sqlite3.Connection = Depends(get_conn),
):
    _project_or_404(conn, pid)
    offset = 0
    if cursor:
        if not cursor.startswith("cur_") or not cursor[4:].isdigit():
            raise ApiError("VALIDATION_ERROR", "cursor 无效")
        offset = int(cursor[4:])
    rows = conn.execute(
        "SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
        (pid, limit + 1, offset),
    ).fetchall()
    has_more = len(rows) > limit
    items = [
        m.ConversationSummary(id=r["id"], title=r["title"] or "", updated_at=r["updated_at"], branch_count=branch_count(conn, r["id"]))
        for r in rows[:limit]
    ]
    return m.dump(m.ConversationList(conversations=items, next_cursor=f"cur_{offset + limit}" if has_more else None))


@router.post("/projects/{pid}/conversations")
def create_conversation(pid: str, body: m.CreateConversationBody | None = None, conn: sqlite3.Connection = Depends(get_conn)):
    _project_or_404(conn, pid)
    title = (body.title if body else None) or ""
    title = title.strip() or DEFAULT_CONVERSATION_TITLE
    cid = new_id("cnv")
    now = now_iso()
    conn.execute(
        "INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (cid, pid, title, now, now),
    )
    conn.commit()
    return m.dump(conversation_out(_conversation_or_404(conn, cid)))


@router.get("/conversations/{cid}/tree")
def conversation_tree(cid: str, conn: sqlite3.Connection = Depends(get_conn)):
    conv = _conversation_or_404(conn, cid)
    messages = [
        message_out(conn, r)
        for r in conn.execute("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid", (cid,))
    ]
    branches = [
        branch_out(conn, r)
        for r in conn.execute("SELECT * FROM branches WHERE conversation_id = ? ORDER BY created_at, rowid", (cid,))
    ]
    tree = m.ConversationTree(
        conversation=conversation_out(conv), messages=messages, branches=branches, active_leaf_id=conv["active_leaf_id"]
    )
    return m.dump(tree)


def _descend_latest(conn: sqlite3.Connection, mid: str, branch_id: str | None) -> str:
    """从某条消息沿同一条线（同 branch_id）一直走到最新的叶子。"""
    cur = mid
    seen = {cur}
    while True:
        row = conn.execute(
            "SELECT id FROM messages WHERE parent_id = ? AND branch_id IS ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (cur, branch_id),
        ).fetchone()
        if row is None or row["id"] in seen:
            return cur
        cur = row["id"]
        seen.add(cur)


@router.put("/conversations/{cid}/active_leaf")
def set_active_leaf(cid: str, body: m.ActiveLeafBody, conn: sqlite3.Connection = Depends(get_conn)):
    conv = _conversation_or_404(conn, cid)
    target = conn.execute(
        "SELECT * FROM messages WHERE id = ? AND conversation_id = ?", (body.message_id, cid)
    ).fetchone()
    if target is None:
        raise ApiError("VALIDATION_ERROR", "message_id 不属于该对话")
    path = path_to_root(conn, conv["active_leaf_id"])
    on_path_sibling = None
    for mid in path:
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()
        if row["parent_id"] == target["parent_id"] and row["role"] == "assistant":
            on_path_sibling = row
            break
    if (
        target["role"] != "assistant"
        or on_path_sibling is None
        or on_path_sibling["branch_id"] != target["branch_id"]
    ):
        raise ApiError("VALIDATION_ERROR", "message_id 不是当前回答的兄弟节点")
    leaf = _descend_latest(conn, target["id"], target["branch_id"])
    conn.execute("UPDATE conversations SET active_leaf_id = ? WHERE id = ?", (leaf, cid))
    conn.commit()
    return m.dump(m.ActiveLeaf(active_leaf_id=leaf))
