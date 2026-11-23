"""记忆的读写（L2 对话摘要、L3 条目与 topics/*.md、L4 画像、屏蔽列表）。只在这里写 memory_* 表。

文件位置：`<MN_DATA_DIR>/memory/<scope>/<scope_id 或 _global>/topics/<主题>.md`（memory_topics.md_path 记绝对路径）。
Markdown 只是 L3 的可读副本，数据库是唯一事实源；每次主题内条目变化整份重写。
"""

from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from pathlib import Path

from app import models as m
from app.config import get_config
from app.ids import new_id, now_iso, sha256_text

L4_MAX_TOKENS = 800
DIGEST_MAX_CHARS = 1200


def _loads(text, default):
    try:
        return json.loads(text) if text else default
    except ValueError:
        return default


# ---------- 屏蔽列表 ----------

def content_hash(content: str) -> str:
    norm = unicodedata.normalize("NFKC", content or "").lower()
    norm = re.sub(r"[\s，。,.!！?？：:；;“”\"'「」]", "", norm)
    return sha256_text(norm)


def is_blocked(conn: sqlite3.Connection, content: str) -> bool:
    return conn.execute("SELECT 1 FROM memory_blocklist WHERE content_hash = ?", (content_hash(content),)).fetchone() is not None


def block(conn: sqlite3.Connection, content: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO memory_blocklist (id, content_hash, created_at) VALUES (?, ?, ?)",
        (new_id("blk"), content_hash(content), now_iso()),
    )


# ---------- L3 条目 ----------

def item_out(row: sqlite3.Row) -> m.MemoryItem:
    return m.MemoryItem(
        id=row["id"],
        scope=row["scope"],
        scope_id=row["scope_id"],
        topic=row["topic"],
        content=row["content"],
        source_message_ids=_loads(row["source_message_ids_json"], []),
        status=row["status"],
        valid_from=row["valid_from"],
        valid_to=row["valid_to"],
        confidence=row["confidence"] if row["confidence"] is not None else 0.0,
        source_conversation_id=row["source_conversation_id"],
    )


def get_item(conn: sqlite3.Connection, item_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM memory_items WHERE id = ?", (item_id,)).fetchone()


def same_topic_items(conn: sqlite3.Connection, scope: str, scope_id: str | None, topic: str, limit: int = 5) -> list[sqlite3.Row]:
    """同作用域、同主题的有效条目，新的在前（判定时取前 5 条）。"""
    return conn.execute(
        "SELECT * FROM memory_items WHERE status = 'active' AND scope = ? AND scope_id IS ? AND topic = ? "
        "ORDER BY valid_from DESC, created_at DESC, rowid DESC LIMIT ?",
        (scope, scope_id, topic, limit),
    ).fetchall()


def insert_item(
    conn: sqlite3.Connection,
    *,
    scope: str,
    scope_id: str | None,
    topic: str,
    content: str,
    source_message_ids: list[str],
    valid_from: str,
    confidence: float,
    source_conversation_id: str | None,
) -> str:
    iid = new_id("mem")
    conn.execute(
        "INSERT INTO memory_items (id, scope, scope_id, topic, content, source_message_ids_json, status, valid_from, "
        "confidence, created_at, source_conversation_id) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
        (iid, scope, scope_id, topic, content, json.dumps(source_message_ids), valid_from, confidence, now_iso(), source_conversation_id),
    )
    return iid


def add_sources(conn: sqlite3.Connection, item_id: str, message_ids: list[str]) -> None:
    row = get_item(conn, item_id)
    ids = _loads(row["source_message_ids_json"], [])
    for x in message_ids:
        if x not in ids:
            ids.append(x)
    conn.execute("UPDATE memory_items SET source_message_ids_json = ? WHERE id = ?", (json.dumps(ids), item_id))


def supersede(conn: sqlite3.Connection, old_id: str, new_id_: str, at: str) -> None:
    conn.execute(
        "UPDATE memory_items SET status = 'superseded', superseded_by = ?, valid_to = ? WHERE id = ?", (new_id_, at, old_id)
    )


# ---------- topics/*.md ----------

def _safe(name: str) -> str:
    s = re.sub(r"[\\/:*?\"<>|\s]+", "_", name or "未分类").strip("._")
    return s[:60] or "未分类"


def topic_md_path(scope: str, scope_id: str | None, topic: str) -> Path:
    return get_config().data_dir / "memory" / scope / _safe(scope_id or "_global") / "topics" / f"{_safe(topic)}.md"


def write_topic(conn: sqlite3.Connection, scope: str, scope_id: str | None, topic: str) -> None:
    """重写一个主题的 Markdown（有效条目 + 历史版本带有效期），并登记 memory_topics。"""
    rows = conn.execute(
        "SELECT * FROM memory_items WHERE scope = ? AND scope_id IS ? AND topic = ? AND status != 'deleted' "
        "ORDER BY valid_from, created_at, rowid",
        (scope, scope_id, topic),
    ).fetchall()
    path = topic_md_path(scope, scope_id, topic)
    trow = conn.execute(
        "SELECT id FROM memory_topics WHERE scope = ? AND scope_id IS ? AND name = ?", (scope, scope_id, topic)
    ).fetchone()
    if not rows:
        if path.exists():
            path.unlink()
        if trow:
            conn.execute("DELETE FROM memory_topics WHERE id = ?", (trow["id"],))
        return
    lines = [f"# {topic}", "", f"作用域：{scope}" + (f" · {scope_id}" if scope_id else ""), ""]
    active = [r for r in rows if r["status"] == "active"]
    old = [r for r in rows if r["status"] == "superseded"]
    lines.append("## 当前")
    lines += [f"- {r['content']}（自 {r['valid_from'] or '?'}；来源 {', '.join(_loads(r['source_message_ids_json'], []))}；{r['id']}）" for r in active] or ["- （无）"]
    if old:
        lines += ["", "## 历史版本"]
        lines += [f"- ~~{r['content']}~~（{r['valid_from'] or '?'} 至 {r['valid_to'] or '?'}，被 {r['superseded_by']} 取代；{r['id']}）" for r in old]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if trow:
        conn.execute("UPDATE memory_topics SET md_path = ?, updated_at = ? WHERE id = ?", (str(path), now_iso(), trow["id"]))
    else:
        conn.execute(
            "INSERT INTO memory_topics (id, scope, scope_id, name, md_path, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (new_id("mtp"), scope, scope_id, topic, str(path), now_iso()),
        )


def rewrite_topics_of_scope(conn: sqlite3.Connection, scope: str, scope_id: str | None) -> None:
    topics = {r[0] for r in conn.execute("SELECT DISTINCT topic FROM memory_items WHERE scope = ? AND scope_id IS ?", (scope, scope_id))}
    topics |= {r[0] for r in conn.execute("SELECT name FROM memory_topics WHERE scope = ? AND scope_id IS ?", (scope, scope_id))}
    for t in topics:
        write_topic(conn, scope, scope_id, t)


# ---------- L4 画像（memory_summaries，每次重写插入新版本，旧版本保留可回滚） ----------

def latest_summary(conn: sqlite3.Connection, scope: str, scope_id: str | None) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM memory_summaries WHERE scope = ? AND scope_id IS ? ORDER BY version DESC LIMIT 1", (scope, scope_id)
    ).fetchone()



def current_summary(conn: sqlite3.Connection, project_id: str | None = None) -> sqlite3.Row | None:
    """给了项目取该项目最新版本；不给取所有项目里最近更新的那份最新版本。"""
    if project_id:
        return latest_summary(conn, "project", project_id)
    return conn.execute(
        "SELECT * FROM memory_summaries s WHERE version = (SELECT MAX(version) FROM memory_summaries t "
        "WHERE t.scope = s.scope AND t.scope_id IS s.scope_id) ORDER BY updated_at DESC, rowid DESC LIMIT 1"
    ).fetchone()

def save_summary(conn: sqlite3.Connection, scope: str, scope_id: str | None, content: str) -> int:
    """内容没变不升版本；返回当前版本号。"""
    prev = latest_summary(conn, scope, scope_id)
    if prev is not None and prev["content"] == content:
        return prev["version"]
    version = (prev["version"] + 1) if prev is not None else 1
    conn.execute(
        "INSERT INTO memory_summaries (id, scope, scope_id, content, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (new_id("msum"), scope, scope_id, content, version, now_iso()),
    )
    return version


# ---------- L2 对话摘要（conversation_digests，每次更新插入新行，按 upto_message_id 判可见） ----------

def latest_digest(conn: sqlite3.Connection, conversation_id: str, branch_id: str | None) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM conversation_digests WHERE conversation_id = ? AND branch_id IS ? ORDER BY updated_at DESC, rowid DESC LIMIT 1",
        (conversation_id, branch_id),
    ).fetchone()


def save_digest(conn: sqlite3.Connection, conversation_id: str, branch_id: str | None, upto_message_id: str, content: str) -> str:
    did = new_id("dig")
    conn.execute(
        "INSERT INTO conversation_digests (id, conversation_id, branch_id, upto_message_id, content, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (did, conversation_id, branch_id, upto_message_id, content, now_iso()),
    )
    return did
