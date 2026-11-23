"""设置 → 记忆：/api/memory/*（契约 rest-api.md“设置与记忆”）。"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app import models as m
from app.api.deps import get_conn
from app.errors import ApiError
from app.ids import now_iso
from app.jobs import worker as jobs
from app.memory import store

router = APIRouter()

_SCOPES = ("global", "project", "branch")
_STATUSES = ("active", "superseded", "deleted")
CONTENT_MAX = 500


def _refresh_profiles(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """条目变动后重写受影响的 L4：project 条目只影响本项目；global 影响所有已有画像的项目；branch 条目不进画像。"""
    if row["scope"] == "project" and row["scope_id"]:
        jobs.enqueue(conn, "rewrite_profile", {"project_id": row["scope_id"]})
    elif row["scope"] == "global":
        for r in conn.execute("SELECT DISTINCT scope_id FROM memory_summaries WHERE scope = 'project'"):
            jobs.enqueue(conn, "rewrite_profile", {"project_id": r[0]})


def _get_live(conn: sqlite3.Connection, item_id: str) -> sqlite3.Row:
    row = store.get_item(conn, item_id)
    if row is None or row["status"] == "deleted":
        raise ApiError("NOT_FOUND", "记忆条目不存在")
    return row


@router.get("/memory/items")
def list_items(scope: str | None = None, q: str | None = None, status: str = "active", conn: sqlite3.Connection = Depends(get_conn)):
    if scope and scope not in _SCOPES:
        raise ApiError("VALIDATION_ERROR", "scope 只能是 global、project 或 branch")
    status = status or "active"
    if status not in _STATUSES:
        raise ApiError("VALIDATION_ERROR", "status 只能是 active、superseded 或 deleted")
    sql = "SELECT * FROM memory_items WHERE status = ?"
    args: list = [status]
    if scope:
        sql += " AND scope = ?"
        args.append(scope)
    if q and q.strip():
        sql += " AND (content LIKE ? OR topic LIKE ?)"
        like = f"%{q.strip()}%"
        args += [like, like]
    sql += " ORDER BY COALESCE(valid_from, created_at) DESC, rowid DESC"
    return m.dump(m.MemoryItemList(items=[store.item_out(r) for r in conn.execute(sql, args)]))


@router.put("/memory/items/{item_id}")
def update_item(item_id: str, body: m.UpdateMemoryItemBody, conn: sqlite3.Connection = Depends(get_conn)):
    row = _get_live(conn, item_id)
    content = body.content.strip()
    if not content:
        raise ApiError("VALIDATION_ERROR", "记忆内容不能为空")
    if len(content) > CONTENT_MAX:
        raise ApiError("VALIDATION_ERROR", f"记忆内容不能超过 {CONTENT_MAX} 字")
    conn.execute("UPDATE memory_items SET content = ? WHERE id = ?", (content, item_id))
    store.write_topic(conn, row["scope"], row["scope_id"], row["topic"])
    _refresh_profiles(conn, row)
    conn.commit()
    jobs.notify()
    return m.dump(store.item_out(store.get_item(conn, item_id)))


@router.delete("/memory/items/{item_id}")
def delete_item(item_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    row = _get_live(conn, item_id)
    conn.execute("UPDATE memory_items SET status = 'deleted', valid_to = COALESCE(valid_to, ?) WHERE id = ?", (now_iso(), item_id))
    store.block(conn, row["content"])  # 进屏蔽列表：同样的内容不会被重新抽取
    store.write_topic(conn, row["scope"], row["scope_id"], row["topic"])
    _refresh_profiles(conn, row)
    conn.commit()
    jobs.notify()
    return m.dump(m.OkResult(ok=True))


@router.get("/memory/summary")
def get_summary(project_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)):
    """L4 画像。`project_id?`（契约 v0.5 草案 [B3a]）：给了取该项目的最新版本；不给取最近更新的一份。"""
    try:
        row = store.current_summary(conn, project_id)
    except sqlite3.Error as e:
        raise ApiError("INTERNAL", "读取画像摘要失败") from e
    if row is None:
        return m.dump(m.MemorySummary(content="", version=0, updated_at=now_iso()))
    return m.dump(m.MemorySummary(content=row["content"], version=row["version"], updated_at=row["updated_at"]))
