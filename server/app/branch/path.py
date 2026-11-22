"""分支路径可见性（DEVELOPMENT.md：所有“当前分支路径”判断集中在此，检索、记忆召回、open_source、快照读取都调用它）。

“当前路径”＝从叶子沿 parent_id 回到根的消息集合（data-model.md）。

叶子怎么定（契约 v0.4，原 U44）：
- 调用方给了 `leaf_id`（如分支面板里打开证据），且被判断的消息与 `leaf_id` 属于同一对话 → 用 `leaf_id`；
- 否则用被判断消息所在对话的 `active_leaf_id`。跨对话的来源（例如召回的历史对话、在另一个对话里抓的网页）
  不受当前对话叶子影响，按那个对话自己的当前路径判断。
合并后的分支（status=merged 且 merged_into_message_id 在路径上）其消息对路径可见。
"""

from __future__ import annotations

import sqlite3


def path_to_root(conn: sqlite3.Connection, leaf_id: str | None) -> list[str]:
    """从叶子到根的消息 id 列表（叶子在前）。"""
    out: list[str] = []
    seen: set[str] = set()
    cur = leaf_id
    while cur and cur not in seen:
        seen.add(cur)
        row = conn.execute("SELECT id, parent_id FROM messages WHERE id = ?", (cur,)).fetchone()
        if row is None:
            break
        out.append(row["id"])
        cur = row["parent_id"]
    return out


def message_exists(conn: sqlite3.Connection, message_id: str) -> bool:
    return conn.execute("SELECT 1 FROM messages WHERE id = ?", (message_id,)).fetchone() is not None


def resolve_leaf(conn: sqlite3.Connection, conversation_id: str, leaf_id: str | None) -> str | None:
    """leaf_id 属于该对话时用它，否则用该对话的 active_leaf_id。"""
    if leaf_id:
        row = conn.execute("SELECT conversation_id FROM messages WHERE id = ?", (leaf_id,)).fetchone()
        if row is not None and row["conversation_id"] == conversation_id:
            return leaf_id
    row = conn.execute("SELECT active_leaf_id FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
    return row["active_leaf_id"] if row else None


def visible_message_ids(conn: sqlite3.Connection, conversation_id: str, leaf_id: str | None = None) -> set[str]:
    """对话在给定叶子（规则见模块说明）下可见的消息集合：路径上的消息 + 已合并且合并点在路径上的分支消息。"""
    path = set(path_to_root(conn, resolve_leaf(conn, conversation_id, leaf_id)))
    for br in conn.execute(
        "SELECT id, merged_into_message_id FROM branches WHERE conversation_id = ? AND status = 'merged'", (conversation_id,)
    ):
        if br["merged_into_message_id"] in path:
            path.update(r["id"] for r in conn.execute("SELECT id FROM messages WHERE branch_id = ?", (br["id"],)))
    return path


def is_message_visible(conn: sqlite3.Connection, message_id: str, leaf_id: str | None = None) -> bool:
    row = conn.execute("SELECT conversation_id FROM messages WHERE id = ?", (message_id,)).fetchone()
    if row is None:
        return False
    return message_id in visible_message_ids(conn, row["conversation_id"], leaf_id)


def is_evidence_visible(conn: sqlite3.Connection, evidence: sqlite3.Row, leaf_id: str | None = None) -> bool:
    """用户上传材料属于项目，全部可见；网页/插件证据看 captured_in_message_id；历史对话证据看被引消息本身。"""
    st = evidence["source_type"]
    if st == "material":
        return True
    if st in ("web", "plugin"):
        mid = evidence["captured_in_message_id"]
        return True if not mid else is_message_visible(conn, mid, leaf_id)
    if st == "message":
        return is_message_visible(conn, evidence["source_id"], leaf_id)
    return False


def is_snapshot_visible(conn: sqlite3.Connection, snapshot_id: str, leaf_id: str | None = None) -> bool:
    """快照只要被某条可见的网页证据引用就可见；没有任何证据引用时视为可见。"""
    rows = conn.execute(
        "SELECT * FROM evidence WHERE source_type = 'web' AND source_id = ?", (snapshot_id,)
    ).fetchall()
    if not rows:
        return True
    return any(is_evidence_visible(conn, r, leaf_id) for r in rows)
