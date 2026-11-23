"""分支路径可见性（DEVELOPMENT.md：所有“当前分支路径”判断集中在此，检索、记忆召回、open_source、快照读取都调用它）。

“当前路径”＝从叶子沿 parent_id 回到根的消息集合（data-model.md）。

叶子怎么定（契约 v0.4，原 U44）：
- 调用方给了 `leaf_id`（如分支面板里打开证据），且被判断的消息与 `leaf_id` 属于同一对话 → 用 `leaf_id`；
- 否则用被判断消息所在对话的 `active_leaf_id`。跨对话的来源（例如召回的历史对话、在另一个对话里抓的网页）
  不受当前对话叶子影响，按那个对话自己的当前路径判断。
合并后的分支（status=merged 且 merged_into_message_id 在路径上）其消息对路径可见。

分支可见性 5 条规则（data-model.md“分支可见性”，B3a 补全）——全部在本文件，别处只调用：
1. recall_memory：只返回 global、本项目 project 条目，以及 scope=branch 且该分支在当前路径上的条目
   → `memory_item_visible()`、`visible_branch_ids()`；L2 对话摘要同理 → `digest_visible()`。
2. L4 画像只汇总 global 与 project 条目 → `L4_SCOPES`、`l4_items()`。
3. open_source(msg_id)：消息不在当前路径上 → NOT_VISIBLE_ON_PATH → `check_open_source()`。
4. 网页/插件证据：captured_in_message_id 在当前路径上才可见；用户上传材料全部可见 → `is_evidence_visible()`。
5. 合并后分支条目 scope 改为 project → `promote_branch_items()`（合并接口调用）。

“分支在当前路径上”：路径（含已合并进来的分支消息）上任一消息的 branch_id 等于该分支。
记忆条目 scope=branch 时 scope_id 是分支 id（fixture `mem_br_variance.scope_id = br_variance`）。
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


def visible_branch_ids(conn: sqlite3.Connection, conversation_id: str, leaf_id: str | None = None) -> set[str]:
    """当前路径（含已合并分支）上出现过的分支 id。"""
    ids = visible_message_ids(conn, conversation_id, leaf_id)
    if not ids:
        return set()
    qs = ",".join("?" * len(ids))
    return {
        r[0]
        for r in conn.execute(f"SELECT DISTINCT branch_id FROM messages WHERE id IN ({qs}) AND branch_id IS NOT NULL", list(ids))
    }


# ---------- 规则 1：记忆召回 ----------

def memory_item_visible(item: sqlite3.Row | dict, *, project_id: str, branch_ids: set[str]) -> bool:
    """global 全部可见；project 只看本项目；branch 只看当前路径上的分支。"""
    scope = item["scope"]
    if scope == "global":
        return True
    if scope == "project":
        return item["scope_id"] == project_id
    if scope == "branch":
        return item["scope_id"] in branch_ids
    return False


def digest_visible(conn: sqlite3.Connection, digest: sqlite3.Row | dict, *, conversation_id: str, leaf_id: str | None) -> bool:
    """L2 摘要只在它覆盖到的最后一条消息（upto_message_id）对当前路径可见时可用。

    同一对话按 leaf_id 判断（分支里看不到锚点之后的主线摘要、兄弟分支摘要）；其他对话按它自己的 active_leaf_id。
    """
    upto = digest["upto_message_id"]
    if not upto:
        return False
    leaf = leaf_id if digest["conversation_id"] == conversation_id else None
    return is_message_visible(conn, upto, leaf)


# ---------- 规则 2：L4 画像 ----------

L4_SCOPES = ("global", "project")


def l4_items(conn: sqlite3.Connection, project_id: str) -> list[sqlite3.Row]:
    """L4 画像的输入：只取 global 与本项目 project 的有效条目，branch 条目一律不进画像。"""
    return conn.execute(
        "SELECT * FROM memory_items WHERE status = 'active' AND "
        "(scope = 'global' OR (scope = 'project' AND scope_id = ?)) ORDER BY created_at, rowid",
        (project_id,),
    ).fetchall()


# ---------- 规则 3：open_source ----------

def check_open_source(
    conn: sqlite3.Connection, message_id: str, *, conversation_id: str | None = None, leaf_id: str | None = None
) -> sqlite3.Row:
    """按 ID 打开一条历史消息前的判定（open_source 工具与接口共用）。

    - 消息不存在 → ApiError NOT_FOUND
    - 不在当前路径上 → ApiError NOT_VISIBLE_ON_PATH
    叶子：消息与 conversation_id 同对话时用 leaf_id（无则该对话 active_leaf_id）；跨对话按那个对话自己的 active_leaf_id。
    返回消息行。
    """
    from app.errors import ApiError  # 延迟导入，避免 path.py 依赖 web 层

    row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    if row is None:
        raise ApiError("NOT_FOUND", "消息不存在")
    leaf = leaf_id if (conversation_id is None or row["conversation_id"] == conversation_id) else None
    if not is_message_visible(conn, message_id, leaf):
        raise ApiError("NOT_VISIBLE_ON_PATH", "这条消息不在当前分支路径上")
    return row


# ---------- 规则 5：合并后条目升 project ----------

def promote_branch_items(conn: sqlite3.Connection, branch_id: str, project_id: str) -> int:
    """分支合并时把该分支的记忆条目（含已 superseded 的历史版本）改为 project 作用域；返回改动条数。不提交事务。"""
    cur = conn.execute(
        "UPDATE memory_items SET scope = 'project', scope_id = ? WHERE scope = 'branch' AND scope_id = ?",
        (project_id, branch_id),
    )
    return cur.rowcount


def is_snapshot_visible(conn: sqlite3.Connection, snapshot_id: str, leaf_id: str | None = None) -> bool:
    """快照只要被某条可见的网页证据引用就可见；没有任何证据引用时视为可见。"""
    rows = conn.execute(
        "SELECT * FROM evidence WHERE source_type = 'web' AND source_id = ?", (snapshot_id,)
    ).fetchall()
    if not rows:
        return True
    return any(is_evidence_visible(conn, r, leaf_id) for r in rows)
