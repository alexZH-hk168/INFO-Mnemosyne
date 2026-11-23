"""B3a：长程记忆写路径（jobs worker）、读路径（recall）、L2/L4、屏蔽列表与 /api/memory/*。全程用 llm_port 的确定性假实现。"""

from __future__ import annotations

import json

import pytest

from app.ids import new_id
from app.jobs import worker as jobs
from app.memory import store
from app.memory.service import memory
from tests.conftest import create_project


@pytest.fixture
def conv(client, db):
    pid = create_project(client, "记忆测试")
    cid = client.post(f"/api/projects/{pid}/conversations", json={"title": "偏好"}).json()["id"]
    return {"pid": pid, "cid": cid, "leaf": None}


def turn(db, conv, user_text, at, answer="好的，记下了。", branch_id=None, parent=None):
    """模拟 B2 落库一轮问答后调用 on_turn_finished。"""
    parent = parent if parent is not None else conv["leaf"]
    u, a = new_id("msg"), new_id("msg")
    db.execute("INSERT INTO messages (id, conversation_id, parent_id, branch_id, role, content, created_at) VALUES (?, ?, ?, ?, 'user', ?, ?)",
               (u, conv["cid"], parent, branch_id, user_text, at))
    db.execute("INSERT INTO messages (id, conversation_id, parent_id, branch_id, role, content, created_at) VALUES (?, ?, ?, ?, 'assistant', ?, ?)",
               (a, conv["cid"], u, branch_id, answer, at))
    if branch_id is None:
        if parent is None:
            db.execute("UPDATE conversations SET root_message_id = ? WHERE id = ?", (u, conv["cid"]))
        db.execute("UPDATE conversations SET active_leaf_id = ? WHERE id = ?", (a, conv["cid"]))
        conv["leaf"] = a
    db.commit()
    memory.on_turn_finished(db, conversation_id=conv["cid"], assistant_message_id=a)
    results = jobs.run_pending_jobs(db)
    assert all(r["status"] == "done" for r in results), results
    return u, a


def items(db, **where):
    sql = "SELECT * FROM memory_items" + (" WHERE " + " AND ".join(f"{k} = ?" for k in where) if where else "") + " ORDER BY rowid"
    return db.execute(sql, list(where.values())).fetchall()


# ---------- 验收：先喜欢 A、后改成 B → A 被 SUPERSEDE，能取回 A 及有效期 ----------

def test_preference_change_supersedes_and_recall_returns_old_with_validity(client, db, conv):
    u1, _ = turn(db, conv, "我喜欢用 PyTorch 写实验。", "2026-11-20T10:00:00Z")
    rows = items(db)
    assert len(rows) == 1 and rows[0]["scope"] == "global" and rows[0]["status"] == "active"
    a_id = rows[0]["id"]
    assert rows[0]["content"] == "用户喜欢用 PyTorch 写实验"
    assert json.loads(rows[0]["source_message_ids_json"]) == [u1]
    assert rows[0]["valid_from"] == "2026-11-20T10:00:00Z" and rows[0]["source_conversation_id"] == conv["cid"]

    u2, _ = turn(db, conv, "我现在改成喜欢用 JAX 了。", "2026-11-22T09:30:00Z")
    old = db.execute("SELECT * FROM memory_items WHERE id = ?", (a_id,)).fetchone()
    new = db.execute("SELECT * FROM memory_items WHERE status = 'active'").fetchall()
    assert len(new) == 1 and new[0]["content"] == "用户喜欢用 JAX"
    assert old["status"] == "superseded" and old["superseded_by"] == new[0]["id"]
    assert old["valid_from"] == "2026-11-20T10:00:00Z" and old["valid_to"] == "2026-11-22T09:30:00Z"

    # 问“我以前喜欢什么”：召回旧条目 A 及其有效期，并指回 L1 原话
    drafts = memory.recall(db, project_id=conv["pid"], conversation_id=conv["cid"], leaf_message_id=None, query="我以前喜欢什么？")
    old_d = [d for d in drafts if "PyTorch" in d.title]
    assert old_d, [d.title for d in drafts]
    d = old_d[0]
    assert "已过时：2026-11-20T10:00:00Z 至 2026-11-22T09:30:00Z" in d.title
    assert d.kind == "message" and d.source_id == u1 and d.quote == "我喜欢用 PyTorch 写实验。"
    assert d.locator == {"message_id": u1, "char_range": [0, len(d.quote)]}
    assert any("JAX" in x.title and "当前有效" in x.title for x in drafts)
    # 没有回溯词时默认只返回 active
    drafts = memory.recall(db, project_id=conv["pid"], conversation_id=conv["cid"], leaf_message_id=None, query="我喜欢用什么框架")
    mem = [x.title for x in drafts if x.title.startswith("历史对话 · ")]  # L3 条目（L2 摘要是对话原话的摘要，另算）
    assert any("JAX" in t for t in mem) and not any("PyTorch" in t for t in mem)

    # “我以前喜欢什么？”这句提问本身不会被抽成新偏好
    turn(db, conv, "我以前喜欢什么？", "2026-11-22T10:00:00Z")
    assert len(items(db, status="active")) == 1

    # 设置页：历史版本带有效期
    r = client.get("/api/memory/items", params={"status": "superseded"}).json()["items"]
    assert [x["id"] for x in r] == [a_id] and r[0]["valid_to"] == "2026-11-22T09:30:00Z"

    # L3 主题 md：当前 + 历史版本
    md = store.topic_md_path("global", None, "偏好").read_text(encoding="utf-8")
    assert "用户喜欢用 JAX" in md and "~~用户喜欢用 PyTorch 写实验~~" in md and "2026-11-22T09:30:00Z" in md

    # L4：只写当前偏好，版本号递增
    profile = memory.l4_profile(db, conv["pid"])
    assert "JAX" in profile and "PyTorch" not in profile
    s = client.get("/api/memory/summary", params={"project_id": conv["pid"]}).json()
    assert s["content"] == profile and s["version"] == 2
    versions = [r[0] for r in db.execute("SELECT version FROM memory_summaries WHERE scope_id = ? ORDER BY version", (conv["pid"],))]
    assert versions == [1, 2]  # 旧版本保留，可回滚


def test_judge_noop_and_update(client, db, conv):
    turn(db, conv, "我喜欢 Python。", "2026-11-20T10:00:00Z")
    turn(db, conv, "我喜欢 Python。", "2026-11-20T11:00:00Z")  # 重复 → NOOP，只追加来源
    rows = items(db)
    assert len(rows) == 1 and len(json.loads(rows[0]["source_message_ids_json"])) == 2
    turn(db, conv, "我喜欢 Python 和类型标注。", "2026-11-20T12:00:00Z")  # 同一事实更完整 → UPDATE
    rows = items(db)
    assert len(rows) == 1 and rows[0]["content"] == "用户喜欢 Python 和类型标注" and rows[0]["status"] == "active"
    turn(db, conv, "我也喜欢 Rust。", "2026-11-20T13:00:00Z")  # 没有改变的表述、不同对象 → ADD
    assert len(items(db, status="active")) == 2


def test_scopes_project_items_and_branch_items(client, db, conv):
    turn(db, conv, "我以为 sigmoid 的导数恒为正就不会消失。", "2026-11-20T10:00:00Z")
    rows = items(db)
    assert len(rows) == 1 and rows[0]["scope"] == "project" and rows[0]["scope_id"] == conv["pid"] and rows[0]["topic"] == "易错点"
    # 分支里产生的条目只挂在该分支
    db.execute("INSERT INTO branches (id, conversation_id, fork_message_id, anchor_start, anchor_end, anchor_quote, title, status, created_at) "
               "VALUES ('br_t', ?, ?, 0, 2, '好的', '好的', 'open', '2026-11-20T10:01:00Z')", (conv["cid"], conv["leaf"]))
    db.commit()
    turn(db, conv, "我喜欢先看图再看公式。", "2026-11-20T10:02:00Z", branch_id="br_t", parent=conv["leaf"])
    br = items(db, scope="branch")
    assert len(br) == 1 and br[0]["scope_id"] == "br_t"
    assert "先看图" not in memory.l4_profile(db, conv["pid"])  # 规则 2
    # L2：主线与分支各一份摘要
    digests = db.execute("SELECT branch_id FROM conversation_digests WHERE conversation_id = ?", (conv["cid"],)).fetchall()
    assert {d[0] for d in digests} == {None, "br_t"}


def test_digest_incremental_and_visibility(client, db, conv):
    turn(db, conv, "第一问：什么是梯度？", "2026-11-20T10:00:00Z", answer="梯度是函数增长最快的方向。")
    turn(db, conv, "第二问：什么是学习率？", "2026-11-20T10:05:00Z", answer="学习率控制每一步走多远。")
    d = store.latest_digest(db, conv["cid"], None)
    assert d["upto_message_id"] == conv["leaf"]
    assert "梯度" in d["content"] and "学习率" in d["content"]
    drafts = memory.recall(db, project_id=conv["pid"], conversation_id=conv["cid"], leaf_message_id=None, query="学习率")
    assert any(x.title.startswith("历史对话摘要") and x.source_id == conv["leaf"] for x in drafts)


def test_delete_blocks_reextraction(client, db, conv):
    turn(db, conv, "我喜欢用 Vim。", "2026-11-20T10:00:00Z")
    iid = items(db)[0]["id"]
    r = client.delete(f"/api/memory/items/{iid}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert client.get("/api/memory/items").json()["items"] == []
    turn(db, conv, "我喜欢用 Vim。", "2026-11-21T10:00:00Z")  # 同样的原话再出现
    assert items(db, status="active") == []
    assert client.delete(f"/api/memory/items/{iid}").status_code == 404
    drafts = memory.recall(db, project_id=conv["pid"], conversation_id=conv["cid"], leaf_message_id=None, query="Vim")
    assert not [d for d in drafts if d.title.startswith("历史对话 · ")]  # 删除的条目不再召回（L2 摘要边界见 U83）
    jobs_rows = db.execute("SELECT status FROM jobs WHERE kind = 'extract_memory'").fetchall()
    assert all(r[0] == "done" for r in jobs_rows)


def test_memory_api(client, db, conv):
    turn(db, conv, "我喜欢先给结论再推导。", "2026-11-20T10:00:00Z")
    turn(db, conv, "我以为 softmax 的输出是独立的。", "2026-11-20T10:05:00Z")
    all_items = client.get("/api/memory/items").json()["items"]
    assert len(all_items) == 2
    assert [x["scope"] for x in client.get("/api/memory/items", params={"scope": "project"}).json()["items"]] == ["project"]
    assert len(client.get("/api/memory/items", params={"q": "softmax"}).json()["items"]) == 1
    r = client.get("/api/memory/items", params={"scope": "team"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.get("/api/memory/items", params={"status": "bogus"}).status_code == 400

    pid_item = next(x for x in all_items if x["scope"] == "project")
    r = client.put(f"/api/memory/items/{pid_item['id']}", json={"content": "曾以为 softmax 各输出独立，实际和为 1。"})
    assert r.status_code == 200 and r.json()["content"] == "曾以为 softmax 各输出独立，实际和为 1。"
    assert "实际和为 1" in store.topic_md_path("project", conv["pid"], "易错点").read_text(encoding="utf-8")
    assert client.put(f"/api/memory/items/{pid_item['id']}", json={"content": "  "}).status_code == 400
    r = client.put("/api/memory/items/mem_missing", json={"content": "x"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    jobs.run_pending_jobs(db)
    assert "实际和为 1" in memory.l4_profile(db, conv["pid"])

    s = client.get("/api/memory/summary").json()
    assert s["version"] >= 1 and s["content"]
    empty = client.get("/api/memory/summary", params={"project_id": "prj_none"}).json()
    assert empty["content"] == "" and empty["version"] == 0


def test_memory_disabled_skips_extraction(client, db, conv, monkeypatch):
    monkeypatch.setenv("MN_MEMORY", "0")
    turn(db, conv, "我喜欢 Haskell。", "2026-11-20T10:00:00Z")
    assert items(db) == [] and db.execute("SELECT COUNT(*) FROM jobs WHERE kind = 'extract_memory'").fetchone()[0] == 0
    monkeypatch.setenv("MN_MEMORY", "1")
    memory.enabled_check = lambda c: False
    try:
        turn(db, conv, "我喜欢 OCaml。", "2026-11-20T10:01:00Z")
        assert items(db) == []
    finally:
        memory.enabled_check = None


def test_hooks_return_this_service():
    from app.agent.hooks import get_memory

    assert get_memory() is memory


def test_job_retry_then_failed(client, db, monkeypatch):
    from app.memory import pipeline

    calls = []

    def boom(conn, payload):
        calls.append(1)
        raise RuntimeError("模型不可用")

    monkeypatch.setitem(pipeline.HANDLERS, "rewrite_profile", boom)
    jid = jobs.enqueue(db, "rewrite_profile", {"project_id": "prj_x"}, commit=True)
    assert jobs.enqueue(db, "rewrite_profile", {"project_id": "prj_x"}, commit=True) == jid  # 去重
    out = jobs.run_pending_jobs(db)
    assert len(calls) == jobs.MAX_ATTEMPTS and out[-1]["status"] == "failed"
    row = db.execute("SELECT status, attempts, error FROM jobs WHERE id = ?", (jid,)).fetchone()
    assert row["status"] == "failed" and row["attempts"] == jobs.MAX_ATTEMPTS and "模型不可用" in row["error"]
    with pytest.raises(ValueError):
        jobs.enqueue(db, "parse_document", {})  # parse_document 归 B1 的 ParseWorker


def test_worker_thread_processes_jobs(client, db, conv):
    """后台线程版本：唤醒后在几秒内把 extract_memory 做完。"""
    import time

    from app.config import get_config

    w = jobs.JobsWorker(get_config().db_path)
    w.start()
    try:
        u, a = new_id("msg"), new_id("msg")
        db.execute("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', '我喜欢 Julia。', '2026-11-20T10:00:00Z')", (u, conv["cid"]))
        db.execute("INSERT INTO messages (id, conversation_id, parent_id, role, content, created_at) VALUES (?, ?, ?, 'assistant', '好。', '2026-11-20T10:00:00Z')", (a, conv["cid"], u))
        db.commit()
        memory.on_turn_finished(db, conversation_id=conv["cid"], assistant_message_id=a)
        for _ in range(50):
            if items(db):
                break
            time.sleep(0.1)
        assert items(db)[0]["content"] == "用户喜欢 Julia"
    finally:
        w.stop()
        w.join(timeout=5)
