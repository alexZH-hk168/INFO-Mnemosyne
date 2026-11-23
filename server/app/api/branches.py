"""分支：/api/branches*（契约 rest-api.md“分支”）。可见性规则全部在 app/branch/path.py。

合并（架构图 f5-branching 下半部）：① 模型总结分支要点 → ② 在主线末尾插入 role=merge_note 的消息 →
③ 分支记忆条目 branch → project（规则 5）→ ④ status=merged、merged_into_message_id 指向合并卡片。
合并卡片成为对话的 active_leaf，于是分支消息经 visible_message_ids 对主线可见。
"""

from __future__ import annotations

import re
import sqlite3

from fastapi import APIRouter, Depends

from app import models as m
from app.api.deps import get_conn
from app.branch.path import path_to_root, promote_branch_items
from app.errors import ApiError
from app.ids import new_id, now_iso
from app.jobs import worker as jobs
from app.memory import llm_port, store
from app.memory.pipeline import _turns, plain
from app.repo import branch_out, message_out

router = APIRouter()

TITLE_MAX = 60
AUTO_TITLE_LEN = 12  # U48：标题取 anchor.quote 去首尾空白后的前 12 个字符（码点）


def _ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def auto_title(quote: str) -> str:
    return _ws(quote)[:AUTO_TITLE_LEN]


def _branch_or_404(conn: sqlite3.Connection, bid: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM branches WHERE id = ?", (bid,)).fetchone()
    if row is None:
        raise ApiError("NOT_FOUND", "分支不存在")
    return row


@router.post("/branches")
def create_branch(body: m.CreateBranchBody, conn: sqlite3.Connection = Depends(get_conn)):
    conv = conn.execute("SELECT * FROM conversations WHERE id = ?", (body.conversation_id,)).fetchone()
    if conv is None:
        raise ApiError("NOT_FOUND", "对话不存在")
    fork = conn.execute("SELECT * FROM messages WHERE id = ?", (body.fork_message_id,)).fetchone()
    if fork is None:
        raise ApiError("NOT_FOUND", "消息不存在")
    if fork["conversation_id"] != conv["id"]:
        raise ApiError("VALIDATION_ERROR", "fork_message_id 不属于该对话")
    if fork["role"] not in ("assistant", "merge_note"):
        raise ApiError("VALIDATION_ERROR", "只能从助手回答开分支")
    if fork["branch_id"]:
        parent = conn.execute("SELECT status FROM branches WHERE id = ?", (fork["branch_id"],)).fetchone()
        if parent is not None and parent["status"] == "archived":
            raise ApiError("VALIDATION_ERROR", "已归档分支里的回答不能再开分支")
    text = plain(fork["content"])
    a = body.anchor
    if not (0 <= a.start < a.end <= len(text)):
        raise ApiError("VALIDATION_ERROR", "anchor 超出回答正文范围")
    if _ws(text[a.start : a.end]) != _ws(a.quote):
        raise ApiError("VALIDATION_ERROR", "anchor.quote 与回答正文 [start, end) 不一致（偏移按去标记纯文本的码点计）")
    bid = new_id("br")
    conn.execute(
        "INSERT INTO branches (id, conversation_id, fork_message_id, anchor_start, anchor_end, anchor_quote, title, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)",
        (bid, conv["id"], fork["id"], a.start, a.end, text[a.start : a.end], auto_title(text[a.start : a.end]), now_iso()),
    )
    conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now_iso(), conv["id"]))
    conn.commit()
    return m.dump(branch_out(conn, _branch_or_404(conn, bid)))


@router.put("/branches/{bid}")
def update_branch(bid: str, body: m.UpdateBranchBody, conn: sqlite3.Connection = Depends(get_conn)):
    br = _branch_or_404(conn, bid)
    if body.status is None and body.title is None:
        raise ApiError("VALIDATION_ERROR", "请求需要 status 或 title")
    if body.title is not None:
        title = _ws(body.title)
        if not title:
            raise ApiError("VALIDATION_ERROR", "分支标题不能为空")
        if len(title) > TITLE_MAX:
            raise ApiError("VALIDATION_ERROR", f"分支标题不能超过 {TITLE_MAX} 字")
        conn.execute("UPDATE branches SET title = ? WHERE id = ?", (title, bid))
    if body.status is not None:
        if body.status != "archived":
            raise ApiError("VALIDATION_ERROR", "status 只能改为 archived")
        if br["status"] == "merged":
            raise ApiError("VALIDATION_ERROR", "已合并的分支不能归档")
        conn.execute("UPDATE branches SET status = 'archived' WHERE id = ?", (bid,))
    conn.commit()
    return m.dump(branch_out(conn, _branch_or_404(conn, bid)))


def _branch_messages(conn: sqlite3.Connection, bid: str) -> list[sqlite3.Row]:
    """分支当前路径上的本分支消息（根 → 叶）。分支叶子＝本分支最新的一条消息。"""
    leaf = conn.execute(
        "SELECT id FROM messages WHERE branch_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", (bid,)
    ).fetchone()
    if leaf is None:
        return []
    out = []
    for mid in reversed(path_to_root(conn, leaf["id"])):
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()
        if row["branch_id"] == bid:
            out.append(row)
    return out


def _mainline_leaf(conn: sqlite3.Connection, conv: sqlite3.Row) -> str | None:
    for mid in path_to_root(conn, conv["active_leaf_id"]):
        row = conn.execute("SELECT branch_id FROM messages WHERE id = ?", (mid,)).fetchone()
        if row["branch_id"] is None:
            return mid
    return None


@router.post("/branches/{bid}/merge")
def merge_branch(bid: str, conn: sqlite3.Connection = Depends(get_conn)):
    br = _branch_or_404(conn, bid)
    if br["status"] == "merged":
        raise ApiError("VALIDATION_ERROR", "分支已合并")
    if br["status"] == "archived":
        raise ApiError("VALIDATION_ERROR", "已归档的分支不能合并")
    msgs = _branch_messages(conn, bid)
    if not any(x["role"] == "assistant" for x in msgs):
        raise ApiError("VALIDATION_ERROR", "分支里还没有回答，无法合并")
    conv = conn.execute("SELECT * FROM conversations WHERE id = ?", (br["conversation_id"],)).fetchone()
    parent = _mainline_leaf(conn, conv) or br["fork_message_id"]

    data = {"title": br["title"], "anchor_quote": br["anchor_quote"], "turns": _turns(msgs)}
    summary = (llm_port.complete_json("merge", llm_port.build_prompt("merge", data), data=data).get("content") or "").strip()
    note_id = new_id("msg")
    ts = now_iso()
    conn.execute(
        "INSERT INTO messages (id, conversation_id, parent_id, branch_id, role, content, created_at) VALUES (?, ?, ?, NULL, 'merge_note', ?, ?)",
        (note_id, conv["id"], parent, summary, ts),
    )
    conn.execute("UPDATE branches SET status = 'merged', merged_into_message_id = ? WHERE id = ?", (note_id, bid))
    conn.execute("UPDATE conversations SET active_leaf_id = ?, updated_at = ? WHERE id = ?", (note_id, ts, conv["id"]))
    topics = [r[0] for r in conn.execute("SELECT DISTINCT topic FROM memory_items WHERE scope = 'branch' AND scope_id = ?", (bid,))]
    if promote_branch_items(conn, bid, conv["project_id"]):
        store.rewrite_topics_of_scope(conn, "branch", bid)  # 删掉分支作用域的 md
        for t in topics:
            store.write_topic(conn, "project", conv["project_id"], t)
    jobs.enqueue(conn, "rewrite_digest", {"conversation_id": conv["id"], "branch_id": None, "message_id": note_id})
    jobs.enqueue(conn, "rewrite_profile", {"project_id": conv["project_id"]})
    conn.commit()
    jobs.notify()
    note = conn.execute("SELECT * FROM messages WHERE id = ?", (note_id,)).fetchone()
    return m.dump(m.MergeResult(branch=branch_out(conn, _branch_or_404(conn, bid)), merge_note=message_out(conn, note)))
