"""记忆写路径（回合后异步，jobs worker 调用）：① 抽取候选 → ② 与同主题前 5 条比对 → ③ 写 L3（memory_items + topics/*.md）
→ ④ 按规则重写 L2 对话摘要与 L4 画像（保留版本号）。见架构图 f3-memory。

作用域：分支内产生的条目只挂在该分支（scope=branch, scope_id=分支 id）；主线上偏好进 global，其余进 project。
"""

from __future__ import annotations

import logging
import re
import sqlite3

from app.branch.path import l4_items, path_to_root
from app.memory import llm_port, store

log = logging.getLogger("mnemosyne.memory")

_MARKER = re.compile(r"\[\[E\d+\]\]")


def plain(text: str) -> str:
    """去掉 [[E#]] 标记后的纯文本（契约偏移的坐标系）。"""
    return _MARKER.sub("", text or "")


def _msg(conn: sqlite3.Connection, mid: str | None) -> sqlite3.Row | None:
    if not mid:
        return None
    return conn.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()


def _user_of(conn: sqlite3.Connection, assistant: sqlite3.Row) -> sqlite3.Row | None:
    cur = _msg(conn, assistant["parent_id"])
    while cur is not None and cur["role"] != "user":
        cur = _msg(conn, cur["parent_id"])
    return cur


def scope_for(cand: dict, project_id: str, branch_id: str | None) -> tuple[str, str | None]:
    if branch_id:
        return "branch", branch_id
    if cand.get("type") == "preference":
        return "global", None
    return "project", project_id


# ---------- extract_memory ----------

def run_extract(conn: sqlite3.Connection, payload: dict) -> dict:
    from app.jobs.worker import enqueue

    a = _msg(conn, payload.get("message_id"))
    if a is None:
        return {"skipped": "消息不存在"}
    conv = conn.execute("SELECT * FROM conversations WHERE id = ?", (a["conversation_id"],)).fetchone()
    if conv is None:
        return {"skipped": "对话不存在"}
    u = _user_of(conn, a) if a["role"] != "user" else a
    data = {
        "user": u["content"] if u else "",
        "assistant": plain(a["content"]) if a["role"] != "user" else "",
        "user_message_id": u["id"] if u else None,
        "assistant_message_id": a["id"],
    }
    out = llm_port.complete_json("extract", llm_port.build_prompt("extract", data), data=data)
    valid_from = (u or a)["created_at"]
    actions: list[dict] = []
    touched: set[tuple[str, str | None, str]] = set()
    for cand in out.get("candidates") or []:
        content = (cand.get("content") or "").strip()
        topic = (cand.get("topic") or "未分类").strip()
        if not content:
            continue
        if store.is_blocked(conn, content):  # 用户删过的条目不再抽取
            actions.append({"action": "BLOCKED", "content": content})
            continue
        scope, scope_id = scope_for(cand, conv["project_id"], a["branch_id"])
        existing = store.same_topic_items(conn, scope, scope_id, topic, limit=5)
        jdata = {"candidate": {**cand, "content": content, "topic": topic},
                 "existing": [{"id": r["id"], "topic": r["topic"], "content": r["content"]} for r in existing]}
        decision = llm_port.complete_json("judge", llm_port.build_prompt("judge", jdata), data=jdata)
        act = (decision.get("action") or "ADD").upper()
        target = decision.get("target_id")
        ids = {r["id"] for r in existing}
        if act in ("UPDATE", "SUPERSEDE", "NOOP") and target not in ids:
            act = "ADD"  # 模型给了不存在的目标：按新增处理
        sources = [x for x in (cand.get("source_msg_ids") or []) if x] or [data["user_message_id"] or a["id"]]
        conf = float(cand.get("confidence") or 0.5)
        if act == "NOOP":
            store.add_sources(conn, target, sources)
            actions.append({"action": "NOOP", "target_id": target})
            continue
        if act == "UPDATE":
            new_content = (decision.get("content") or content).strip()
            if store.is_blocked(conn, new_content):
                actions.append({"action": "BLOCKED", "content": new_content})
                continue
            conn.execute(
                "UPDATE memory_items SET content = ?, confidence = MAX(COALESCE(confidence, 0), ?) WHERE id = ?",
                (new_content, conf, target),
            )
            store.add_sources(conn, target, sources)
            actions.append({"action": "UPDATE", "target_id": target})
        else:
            iid = store.insert_item(
                conn, scope=scope, scope_id=scope_id, topic=topic, content=content, source_message_ids=sources,
                valid_from=valid_from, confidence=conf, source_conversation_id=conv["id"],
            )
            if act == "SUPERSEDE":
                store.supersede(conn, target, iid, valid_from)
                actions.append({"action": "SUPERSEDE", "target_id": target, "item_id": iid})
            else:
                actions.append({"action": "ADD", "item_id": iid})
        touched.add((scope, scope_id, topic))
    for scope, scope_id, topic in touched:
        store.write_topic(conn, scope, scope_id, topic)
    enqueue(conn, "rewrite_digest", {"conversation_id": conv["id"], "branch_id": a["branch_id"], "message_id": a["id"]})
    if any(s != "branch" for s, _, _ in touched):
        enqueue(conn, "rewrite_profile", {"project_id": conv["project_id"]})
    return {"actions": actions}


# ---------- rewrite_digest（L2） ----------

def _turns(msgs: list[sqlite3.Row]) -> list[dict]:
    turns: list[dict] = []
    cur: dict | None = None
    for mrow in msgs:
        if mrow["role"] == "user":
            cur = {"user": mrow["content"], "assistant": ""}
            turns.append(cur)
        elif mrow["role"] in ("assistant", "merge_note"):
            if cur is None or cur["assistant"]:
                cur = {"user": "", "assistant": ""}
                turns.append(cur)
            cur["assistant"] = plain(mrow["content"])
    return turns


def run_digest(conn: sqlite3.Connection, payload: dict) -> dict:
    cid, bid, mid = payload.get("conversation_id"), payload.get("branch_id"), payload.get("message_id")
    if _msg(conn, mid) is None:
        return {"skipped": "消息不存在"}
    path = list(reversed(path_to_root(conn, mid)))  # 根 → 叶
    prev = store.latest_digest(conn, cid, bid)
    if prev is not None and prev["upto_message_id"] == mid:
        return {"skipped": "已是最新"}
    start = 0
    previous = ""
    if prev is not None and prev["upto_message_id"] in path:  # 增量：只并入上次之后的消息
        start = path.index(prev["upto_message_id"]) + 1
        previous = prev["content"]
    rows = [_msg(conn, x) for x in path[start:]]
    rows = [r for r in rows if r is not None and r["branch_id"] == bid]  # 每段对话 / 每个分支各一份
    data = {"previous": previous, "turns": _turns(rows), "max_chars": store.DIGEST_MAX_CHARS}
    out = llm_port.complete_json("digest", llm_port.build_prompt("digest", data), data=data)
    did = store.save_digest(conn, cid, bid, mid, out.get("content") or previous)
    return {"digest_id": did}


# ---------- rewrite_profile（L4） ----------

def build_profile(conn: sqlite3.Connection, project_id: str) -> str:
    rows = l4_items(conn, project_id)  # 规则 2：只汇总 global 与 project
    data = {
        "preferences": [r["content"] for r in rows if r["scope"] == "global"],
        "items": [{"topic": r["topic"], "content": r["content"]} for r in rows if r["scope"] == "project"],
        "max_tokens": store.L4_MAX_TOKENS,
    }
    return (llm_port.complete_json("profile", llm_port.build_prompt("profile", data), data=data).get("content") or "").strip()


def run_profile(conn: sqlite3.Connection, payload: dict) -> dict:
    pid = payload.get("project_id")
    if not pid:
        return {"skipped": "缺 project_id"}
    version = store.save_summary(conn, "project", pid, build_profile(conn, pid))
    return {"version": version}


HANDLERS = {"extract_memory": run_extract, "rewrite_digest": run_digest, "rewrite_profile": run_profile}
