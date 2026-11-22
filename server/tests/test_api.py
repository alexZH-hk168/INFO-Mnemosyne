"""接口行为：每个接口成功/失败、分支可见性三组用例、active_leaf、后台线程、脚本。"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

from app.ids import new_id, now_iso
from tests.conftest import create_project, make_text_pdf, upload
from tests.seed import seed_world

SERVER = Path(__file__).resolve().parents[1]


@pytest.fixture
def world(client, db):
    from app.config import get_config

    seed_world(db, get_config().files_dir)
    return db


# ---------- 项目与对话 ----------

def test_projects_crud_and_validation(client):
    assert client.get("/api/projects").json() == {"projects": []}
    p = client.post("/api/projects", json={"name": "  强化学习  "}).json()
    assert p["name"] == "强化学习" and p["conversation_count"] == 0 and p["id"].startswith("prj_")
    assert client.post("/api/projects", json={"name": "x" * 61}).status_code == 400
    r = client.post("/api/projects", json={})
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    c = client.post(f"/api/projects/{p['id']}/conversations", json={"title": "第一讲"}).json()
    assert c["title"] == "第一讲" and "root_message_id" not in c and "active_leaf_id" not in c
    c2 = client.post(f"/api/projects/{p['id']}/conversations").json()  # 无请求体
    assert c2["title"] == "新对话"
    assert client.get("/api/projects").json()["projects"][0]["conversation_count"] == 2


def test_conversation_pagination(world, client):
    first = client.get("/api/projects/prj_dlintro/conversations", params={"limit": 3}).json()
    assert [c["id"] for c in first["conversations"]] == ["cnv_transformer", "cnv_backprop_hw3", "cnv_week6_cards"]
    assert first["conversations"][0]["branch_count"] == 2
    second = client.get("/api/projects/prj_dlintro/conversations", params={"limit": 3, "cursor": first["next_cursor"]}).json()
    assert [c["id"] for c in second["conversations"]] == ["cnv_old_1", "cnv_old_0"]
    assert "next_cursor" not in second
    assert client.get("/api/projects/prj_dlintro/conversations", params={"cursor": "bogus"}).status_code == 400
    assert client.get("/api/projects/prj_dlintro/conversations", params={"limit": 0}).status_code == 400


def test_active_leaf_switch_and_back(world, client):
    r = client.put("/api/conversations/cnv_transformer/active_leaf", json={"message_id": "msg_tf_a1b"})
    assert r.json() == {"active_leaf_id": "msg_tf_a1b"}
    # 切回原回答：落到该回答这条主线上最新的叶子（seed 在 msg_tf_a2 后接了 F4 的代码问答回合，叶子是 msg_code_a1）
    r = client.put("/api/conversations/cnv_transformer/active_leaf", json={"message_id": "msg_tf_a1"})
    assert r.json() == {"active_leaf_id": "msg_code_a1"}
    tree = client.get("/api/conversations/cnv_transformer/tree").json()
    assert tree["active_leaf_id"] == "msg_code_a1" and tree["conversation"]["active_leaf_id"] == "msg_code_a1"
    assert client.put("/api/conversations/cnv_transformer/active_leaf", json={"message_id": "msg_tf_u2"}).status_code == 400
    assert client.put("/api/conversations/cnv_transformer/active_leaf", json={"message_id": "msg_hw3_a2"}).status_code == 400
    assert client.put("/api/conversations/cnv_missing/active_leaf", json={"message_id": "x"}).status_code == 404


# ---------- 分支可见性三组 ----------

def test_visibility_sibling_branch_hidden(world, client):
    r = client.get("/api/evidence/evd_sibling_branch")
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_VISIBLE_ON_PATH"
    assert client.get("/api/web_snapshots/ws_sibling_branch").status_code == 403
    assert client.get("/api/evidence/evd_jalammar_scale").status_code == 200  # 主线上抓的网页
    assert client.get("/api/evidence/evd_att_p4_fn4").status_code == 200  # 用户材料总是可见


def test_visibility_after_merge(world, client, db):
    mid = "msg_merge_note"
    db.execute(
        "INSERT INTO messages (id, conversation_id, parent_id, role, content, created_at) VALUES (?, 'cnv_transformer', 'msg_tf_a2', 'merge_note', '合并：方差为什么是 dₖ', ?)",
        (mid, now_iso()),
    )
    db.execute("UPDATE branches SET status = 'merged', merged_into_message_id = ? WHERE id = 'br_variance'", (mid,))
    db.execute("UPDATE conversations SET active_leaf_id = ? WHERE id = 'cnv_transformer'", (mid,))
    db.commit()
    assert client.get("/api/evidence/evd_sibling_branch").status_code == 200
    assert client.get("/api/web_snapshots/ws_sibling_branch").status_code == 200


def test_visibility_message_evidence_by_id(world, client, db):
    # 被引的历史消息不在其对话当前路径上（用户切到了另一个兄弟回答）→ 按 ID 访问被拒
    db.execute(
        "INSERT INTO messages (id, conversation_id, parent_id, role, content, created_at) VALUES ('msg_hw3_a2b', 'cnv_backprop_hw3', 'msg_hw3_u2', 'assistant', '另一个回答', ?)",
        (now_iso(),),
    )
    db.execute("UPDATE conversations SET active_leaf_id = 'msg_hw3_a2b' WHERE id = 'cnv_backprop_hw3'")
    db.commit()
    r = client.get("/api/evidence/evd_hw3_sigmoid")
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_VISIBLE_ON_PATH"


def test_message_evidence_context_filtered(world, client):
    ev = client.get("/api/evidence/evd_hw3_sigmoid").json()
    assert [m["id"] for m in ev["context_messages"]] == ["msg_hw3_u2", "msg_hw3_a2", "msg_hw3_u3"]
    assert ev["context_messages"][1]["steps"] == [] and "steps" not in ev["context_messages"][0]


# ---------- leaf_id（契约 v0.4，原 U44） ----------

def test_leaf_id_opens_branch_evidence(world, client):
    # 分支面板里传分支叶子：分支内抓的网页可见；不传或传主线叶子仍 403
    for path in ("/api/evidence/evd_sibling_branch", "/api/web_snapshots/ws_sibling_branch"):
        assert client.get(path, params={"leaf_id": "msg_bv_a2"}).status_code == 200
        assert client.get(path, params={"leaf_id": "msg_bv_a1"}).status_code == 200  # 抓取消息本身也在路径上
        assert client.get(path).status_code == 403
        assert client.get(path, params={"leaf_id": "msg_tf_a2"}).status_code == 403
    # 反过来：在分支里看主线之后才抓的网页（msg_tf_a2 在 fork 点之后）不可见
    assert client.get("/api/evidence/evd_pytorch").status_code == 200
    assert client.get("/api/evidence/evd_pytorch", params={"leaf_id": "msg_bv_a2"}).status_code == 403
    assert client.get("/api/web_snapshots/ws_pytorch_sdpa", params={"leaf_id": "msg_bv_a2"}).status_code == 403
    # fork 点之前的主线网页（msg_tf_a1 抓的）在分支里可见
    assert client.get("/api/evidence/evd_jalammar_scale", params={"leaf_id": "msg_bv_a2"}).status_code == 200


def test_leaf_id_other_conversation_and_validation(world, client, db):
    # leaf_id 属于另一个对话：历史对话证据按它自己对话的 active_leaf_id 判断，不受影响
    ev = client.get("/api/evidence/evd_hw3_sigmoid", params={"leaf_id": "msg_tf_a2"})
    assert ev.status_code == 200 and len(ev.json()["context_messages"]) == 3
    # 同一对话的 leaf_id 可以改变历史消息证据的可见性与上下文
    db.execute(
        "INSERT INTO messages (id, conversation_id, parent_id, role, content, created_at) VALUES ('msg_hw3_a2b', 'cnv_backprop_hw3', 'msg_hw3_u2', 'assistant', '另一个回答', ?)",
        (now_iso(),),
    )
    db.commit()
    assert client.get("/api/evidence/evd_hw3_sigmoid", params={"leaf_id": "msg_hw3_a2b"}).status_code == 403
    ctx = client.get("/api/evidence/evd_hw3_sigmoid", params={"leaf_id": "msg_hw3_a2"}).json()["context_messages"]
    assert [m["id"] for m in ctx] == ["msg_hw3_u2", "msg_hw3_a2"]  # 叶子就是被引消息，后一条不在路径上
    # 用户材料不受 leaf_id 影响
    assert client.get("/api/evidence/evd_att_p4_fn4", params={"leaf_id": "msg_bv_a2"}).status_code == 200
    # 不存在的 leaf_id → 400；不存在的证据仍优先 404
    for path in ("/api/evidence/evd_att_p4_fn4", "/api/web_snapshots/ws_jalammar_illustrated"):
        r = client.get(path, params={"leaf_id": "msg_missing"})
        assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.get("/api/evidence/evd_missing", params={"leaf_id": "msg_missing"}).status_code == 404


def test_steps_label_from_column(world, client, db):
    tree = client.get("/api/conversations/cnv_transformer/tree").json()
    a1 = next(m for m in tree["messages"] if m["id"] == "msg_tf_a1")
    assert a1["steps"][0]["label"] == "检索项目材料：2 份材料命中"
    # label 为空时退回 tool_name；args_json 里的 label 不再被读取
    db.execute("UPDATE tool_calls SET label = NULL, args_json = ? WHERE id = 'stp_tf1_1'", (json.dumps({"label": "旧约定"}),))
    db.commit()
    tree = client.get("/api/conversations/cnv_transformer/tree").json()
    a1 = next(m for m in tree["messages"] if m["id"] == "msg_tf_a1")
    assert a1["steps"][0]["label"] == "search_materials"


def test_migrate_v1_database_adds_label(env):
    import sqlite3

    from app.config import get_config
    from app.db.conn import connect, init_db

    path = get_config().db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    old = sqlite3.connect(path)
    old.execute(
        "CREATE TABLE tool_calls (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, step_index INTEGER NOT NULL, tool_name TEXT NOT NULL, "
        "args_json TEXT, result_json TEXT, status TEXT, duration_ms INTEGER)"
    )
    old.execute("PRAGMA user_version = 1")
    old.commit()
    old.close()
    conn = connect()
    init_db(conn)
    assert "label" in {r[1] for r in conn.execute("PRAGMA table_info(tool_calls)")}
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
    conn.close()


# ---------- 材料 ----------

def test_documents_errors(world, client):
    assert client.get("/api/projects/prj_missing/documents").status_code == 404
    r = upload(client, "prj_dlintro", [("ok.md", b"# a\n"), ("作业.docx", b"x")])
    assert r.status_code == 400 and ".docx" in r.json()["error"]["message"]
    # 整批拒绝，不落半批
    titles = [d["title"] for g in client.get("/api/projects/prj_dlintro/documents").json()["groups"] for d in g["documents"]]
    assert "ok.md" not in titles
    assert upload(client, "prj_missing", [("a.md", b"x")]).status_code == 404
    assert client.post("/api/projects/prj_dlintro/documents").status_code == 400  # 没有 file 字段
    assert client.post("/api/documents/doc_missing/reparse").status_code == 404
    assert client.post("/api/documents/doc_web_illustrated/reparse").status_code == 400
    assert client.get("/api/documents/doc_web_illustrated/raw").status_code == 404
    assert client.get("/api/evidence/evd_missing").status_code == 404
    assert client.get("/api/web_snapshots/ws_missing").status_code == 404


def test_documents_grouping_and_counts(world, client):
    groups = client.get("/api/projects/prj_dlintro/documents").json()["groups"]
    assert [g["group"] for g in groups] == ["paper", "slides", "code", "notes", "web"]
    docs = {d["id"]: d for g in groups for d in g["documents"]}
    assert docs["doc_attention"]["cited_count"] == 3  # msg_tf_a1、msg_tf_a2、msg_bv_a1 各一次（removed 不计）
    assert docs["doc_web_illustrated"]["snapshot_id"] == "ws_jalammar_illustrated" and docs["doc_web_illustrated"]["cited_count"] == 0
    assert docs["doc_longmemeval"]["progress"] == 62 and docs["doc_longmemeval"]["parse_status"] == "parsing"


def test_pdf_raw_and_reparse_replaces_index(client, db, run_jobs):
    pid = create_project(client)
    did = upload(client, pid, [("p.pdf", make_text_pdf(["First version of the paper about kernels."] * 3))]).json()["documents"][0]["id"]
    run_jobs()
    raw = client.get(f"/api/documents/{did}/raw")
    assert raw.headers["content-type"] == "application/pdf" and raw.content.startswith(b"%PDF")
    path = db.execute("SELECT path FROM documents WHERE id = ?", (did,)).fetchone()[0]
    Path(path).write_bytes(make_text_pdf(["Second version talks about transformers instead."] * 3))
    r = client.post(f"/api/documents/{did}/reparse")
    assert r.status_code == 200 and r.json()["job_id"].startswith("job_")
    assert client.get(f"/api/documents/{did}").json()["parse_status"] == "queued"
    run_jobs()
    texts = " ".join(row[0] for row in db.execute("SELECT text FROM chunks WHERE document_id = ?", (did,)))
    assert "transformers" in texts and "kernels" not in texts
    assert db.execute("SELECT COUNT(*) FROM chunks_fts WHERE document_id = ?", (did,)).fetchone()[0] == db.execute(
        "SELECT COUNT(*) FROM chunks WHERE document_id = ?", (did,)
    ).fetchone()[0]


def test_unknown_route_uses_error_body(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


# ---------- 后台线程 ----------

def test_background_worker_parses_upload(env, monkeypatch):
    monkeypatch.setenv("MN_WORKER", "1")
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as c:
        pid = create_project(c)
        did = upload(c, pid, [("note.md", "# 标题\n\n后台线程解析。\n".encode())]).json()["documents"][0]["id"]
        deadline = time.time() + 20
        status = None
        while time.time() < deadline:
            status = c.get(f"/api/documents/{did}").json()["parse_status"]
            if status in ("ready", "failed"):
                break
            time.sleep(0.2)
        assert status == "ready"


# ---------- 数据库与脚本 ----------

def test_schema_tables_and_wal(db):
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type IN ('table')")}
    expected = {
        "projects", "conversations", "messages", "branches", "tool_calls", "citations", "documents", "segments",
        "chunks", "evidence", "web_snapshots", "memory_items", "memory_topics", "memory_summaries",
        "conversation_digests", "plugins", "skills", "conversation_plugins", "jobs", "message_events",
        "memory_blocklist", "chunks_fts", "chunks_vec",
    }
    assert expected <= tables
    assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert db.execute("PRAGMA user_version").fetchone()[0] == 2
    cols = {r[1] for r in db.execute("PRAGMA table_info(messages)")}
    assert "client_msg_id" in cols
    assert "label" in {r[1] for r in db.execute("PRAGMA table_info(tool_calls)")}
    assert "captured_in_message_id" in {r[1] for r in db.execute("PRAGMA table_info(evidence)")}
    assert "source_conversation_id" in {r[1] for r in db.execute("PRAGMA table_info(memory_items)")}
    db.execute("INSERT INTO projects (id, name, created_at) VALUES ('p', 'p', 'now')")
    db.execute("INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES ('c', 'p', '', 'n', 'n')")
    db.execute("INSERT INTO messages (id, conversation_id, role, content, created_at, client_msg_id) VALUES ('m1', 'c', 'user', '', 'n', 'u-1')")
    with pytest.raises(Exception):
        db.execute("INSERT INTO messages (id, conversation_id, role, content, created_at, client_msg_id) VALUES ('m2', 'c', 'user', '', 'n', 'u-1')")


def test_dim_mismatch_detected(env, monkeypatch):
    from app.db.conn import EmbeddingDimMismatch, connect, init_db

    conn = connect()
    init_db(conn)
    monkeypatch.setenv("MN_EMBED_DIM", "128")
    with pytest.raises(EmbeddingDimMismatch):
        init_db(conn)
    conn.close()


def _run(args, env):
    return subprocess.run([sys.executable, *args], cwd=SERVER, env=env, capture_output=True, text=True, timeout=120)


def test_scripts_init_and_ingest(env, tmp_path):
    import os

    e = {**os.environ, "MN_DATA_DIR": str(tmp_path / "sdata"), "MN_EMBED_BACKEND": "fake"}
    e.pop("MN_DB_PATH", None)
    e.pop("MN_EMBED_DIM", None)
    db_path = tmp_path / "x.db"
    r = _run(["scripts/init_db.py", "--db", str(db_path)], e)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["schema_version"] == 2 and out["journal_mode"] == "wal"
    src = tmp_path / "mats"
    src.mkdir()
    (src / "a.md").write_text("# A\n\n内容\n", encoding="utf-8")
    (src / "b.py").write_text("def f():\n    return 1\n", encoding="utf-8")
    (src / "c.docx").write_bytes(b"x")
    r = _run(["scripts/ingest.py", "--project", "脚本项目", "--path", str(src)], e)
    assert r.returncode == 0, r.stderr
    lines = [json.loads(x) for x in r.stdout.splitlines()]
    keys = {"document_id", "kind", "pages", "segments", "chunks", "status", "error"}
    assert all(set(x) == keys for x in lines)
    assert sorted(x["status"] for x in lines) == ["ready", "ready", "skipped"]
    r = _run(["scripts/ingest.py", "--project", "脚本项目", "--reindex"], e)
    assert r.returncode == 0, r.stderr
    assert [json.loads(x)["status"] for x in r.stdout.splitlines()] == ["ready", "ready"]
    # 切换维度后必须 --reindex，重建向量表
    e2 = {**e, "MN_EMBED_DIM": "64"}
    assert _run(["scripts/ingest.py", "--project", "脚本项目", "--path", str(src / "a.md")], e2).returncode != 0
    r = _run(["scripts/ingest.py", "--project", "脚本项目", "--reindex"], e2)
    assert r.returncode == 0, r.stderr
