"""B2 接口测试：发消息的完整回合与 SSE 顺序、重复 client_msg_id、断线续流、取消、重新生成、设置、网页抓取、记忆/插件接口。

续流与取消用真实 uvicorn 进程内服务（httpx 真流式读取），其余用 TestClient。模型一律是确定性假模型，不访问外网。
"""

from __future__ import annotations

import json
import os
import re
import socket
import stat
import threading
import time
import uuid

import httpx
import pytest

from .conftest import create_project, load_fixture, upload

DOCS = [
    ("attention.md", "# Attention\n\nScaled dot-product attention divides the dot products by the square root of d_k.\n"),
    ("softmax.md", "# Softmax\n\nWhen the dot products grow large the softmax function has extremely small gradients.\n"),
    ("heads.md", "# Heads\n\nMulti-head attention divides d_model by h and uses the square root of d_k for scaling.\n"),
]
QUESTION = "Why divide the dot products by the square root of d_k in attention?"


# ---------- 公共工具 ----------

def parse_sse(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.split("\n\n"):
        ev, data = None, []
        for line in block.split("\n"):
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        if ev and data:
            out.append((ev, json.loads("\n".join(data))))
    return out


def setup_project(client, run_jobs, docs=DOCS) -> tuple[str, str]:
    pid = create_project(client)
    if docs:
        r = upload(client, pid, [(n, t.encode()) for n, t in docs])
        assert r.status_code == 200, r.text
        run_jobs()
    cid = client.post(f"/api/projects/{pid}/conversations", json={}).json()["id"]
    return pid, cid


def send(client, cid, content=QUESTION, **kw):
    body = {"client_msg_id": kw.pop("client_msg_id", str(uuid.uuid4())), "content": content, "web_search": kw.pop("web_search", False),
            "scope": kw.pop("scope", {"mode": "all"})}
    body.update(kw)
    headers = body.pop("headers", None)
    r = client.post(f"/api/conversations/{cid}/messages", json=body, headers=headers)
    return r, (parse_sse(r.text) if r.status_code == 200 else None), body


ORDER_RE = re.compile(r"^S(?:[PVD])*C*E$")
CODE = {"message.start": "S", "step": "P", "evidence": "V", "delta": "D", "citation": "C", "message.end": "E", "error": "X"}


def order_code(events):
    return "".join(CODE[e] for e, _ in events)


def plain_text(events):
    raw = "".join(d["text"] for e, d in events if e == "delta")
    return re.sub(r"\[\[E\d+\]\]", "", raw)


# ---------- 完整回合 ----------

def test_full_turn_event_order_and_persistence(client, db, run_jobs):
    pid, cid = setup_project(client, run_jobs)
    r, events, body = send(client, cid)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    code = order_code(events)
    assert ORDER_RE.match(code), code  # message.start → (step|evidence|delta)* → citation* → message.end
    assert [d["seq"] for _, d in events] == list(range(1, len(events) + 1))

    start = events[0][1]
    aid = start["message_id"]
    assert start["client_msg_id"] == body["client_msg_id"] and "parent_id" not in start  # 首条消息没有 parent

    # 每个步骤先 running 后 done，且 label 不含“记忆”
    steps = [d for e, d in events if e == "step"]
    by_id: dict[str, list] = {}
    for s in steps:
        by_id.setdefault(s["step_id"], []).append(s["status"])
        assert "记忆" not in s["label"]
    assert all(v == ["running", "done"] for v in by_id.values())
    done = [s for s in steps if s["status"] == "done"]
    # 默认无联网；记忆模块未接入时 recall_memory 返回空
    assert [(s["kind"], s["label"]) for s in done] == [("search_materials", "检索项目材料：3 份材料命中"), ("recall_memory", "没有找到相关的历史对话")]

    evs = [d for e, d in events if e == "evidence"]
    assert [d["label"] for d in evs] == ["E1", "E2", "E3"]
    assert all(d["source_type"] == "material" and "lines" in d["locator"] for d in evs)

    cits = [d for e, d in events if e == "citation"]
    assert [(c["label"], c["verdict"]) for c in cits] == [("E1", "supported"), ("E2", "partial"), ("E3", "removed")]
    plain = plain_text(events)
    for c in cits:
        assert plain[c["sentence_start"]:c["sentence_end"]].endswith("。")
        assert c["eid"] == {d["label"]: d["eid"] for d in evs}[c["label"]]
    end = events[-1][1]
    assert end["message_id"] == aid and end["cancelled"] is False and end["usage"]["completion_tokens"] > 0

    # 写库：正文、步骤（tool_calls.label）、引用、事件缓冲、当前叶子、标题
    row = db.execute("SELECT * FROM messages WHERE id = ?", (aid,)).fetchone()
    assert row["content"] == "".join(d["text"] for e, d in events if e == "delta") and row["model"] == "fake-chat"
    tc = db.execute("SELECT * FROM tool_calls WHERE message_id = ?", (aid,)).fetchall()
    assert [t["label"] for t in tc] == ["检索项目材料：3 份材料命中", "没有找到相关的历史对话"]
    assert all(json.loads(t["args_json"]).get("label") is None for t in tc)  # 文案写 tool_calls.label 列（U46）
    assert db.execute("SELECT COUNT(*) FROM citations WHERE message_id = ?", (aid,)).fetchone()[0] == 3
    assert db.execute("SELECT COUNT(*) FROM message_events WHERE message_id = ?", (aid,)).fetchone()[0] == len(events)
    tree = client.get(f"/api/conversations/{cid}/tree").json()
    assert tree["active_leaf_id"] == aid
    assert tree["conversation"]["title"] == QUESTION[:20]
    am = [m for m in tree["messages"] if m["id"] == aid][0]
    assert [s["label"] for s in am["steps"]] == ["检索项目材料：3 份材料命中", "没有找到相关的历史对话"]
    assert [c["verdict"] for c in am["citations"]] == ["supported", "partial", "removed"]
    # 被引材料计数（removed 不计）
    groups = client.get(f"/api/projects/{pid}/documents").json()["groups"]
    assert sum(d["cited_count"] for g in groups for d in g["documents"]) == 2


def test_event_fields_match_contract_fixture(client, run_jobs):
    _, cid = setup_project(client, run_jobs)
    _, events, _ = send(client, cid)
    fx = load_fixture("sse-turn-full")
    assert ORDER_RE.match(order_code([(e["event"], e["data"]) for e in fx["events"]]))
    want = {}
    for e in fx["events"]:
        want.setdefault(e["event"], set()).update(e["data"].keys())
    contract_start = {"seq", "message_id", "client_msg_id", "user_message_id", "parent_id", "branch_id"}
    for ev, data in events:
        keys = set(data)
        if ev == "message.start":
            assert keys <= contract_start and {"seq", "message_id", "user_message_id"} <= keys
        elif ev == "step":
            assert keys <= {"seq", "step_id", "kind", "label", "status", "duration_ms"}
        else:
            assert keys == want[ev], (ev, keys ^ want[ev])


def test_no_materials_answer_without_citations(client, run_jobs):
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid, "什么是注意力？", scope={"mode": "none"})
    code = order_code(events)
    assert re.match(r"^SP*D+E$", code), code  # 无证据、无引用
    assert "search_materials" not in {d["kind"] for e, d in events if e == "step"}


def test_send_errors(client, run_jobs, monkeypatch):
    _, cid = setup_project(client, run_jobs, docs=[])
    fx = load_fixture("post-conversations-cid-messages.error")
    r, _, _ = send(client, cid, "")
    assert r.status_code == fx["status"] and r.json() == fx["body"]
    r, _, _ = send(client, "cnv_missing")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    r, _, _ = send(client, cid, parent_id="msg_missing")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    r, _, _ = send(client, cid, headers={"X-Model-Tier": "ultra"})
    assert r.status_code == 400
    monkeypatch.setenv("MN_LLM_BACKEND", "openai")
    for k in ("MN_LLM_API_BASE", "MN_LLM_MODEL", "MN_LLM_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    r, _, _ = send(client, cid)
    assert r.status_code == 502 and r.json()["error"]["code"] == "MODEL_UNAVAILABLE" and r.json()["error"]["retriable"] is True


def test_model_tier_fast_uses_small_model(client, db, run_jobs):
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid, headers={"X-Model-Tier": "fast"})
    aid = events[0][1]["message_id"]
    assert db.execute("SELECT model FROM messages WHERE id = ?", (aid,)).fetchone()["model"] == "fake-small"


# ---------- 重复 client_msg_id ----------

def test_duplicate_client_msg_id_returns_same_stream(client, db, run_jobs):
    _, cid = setup_project(client, run_jobs)
    _, first, body = send(client, cid)
    n_before = db.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    _, second, _ = send(client, cid, client_msg_id=body["client_msg_id"])
    assert second == first
    assert db.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == n_before
    # 别的对话用同一个 id → 400
    other = client.post(f"/api/projects/{client.get('/api/projects').json()['projects'][0]['id']}/conversations", json={}).json()["id"]
    r, _, _ = send(client, other, client_msg_id=body["client_msg_id"])
    assert r.status_code == 400


# ---------- 重新生成 ----------

def test_regenerate_creates_sibling_and_moves_active_leaf(client, db, run_jobs):
    _, cid = setup_project(client, run_jobs)
    _, first, body = send(client, cid)
    old = first[0][1]
    r = client.post(f"/api/messages/{old['message_id']}/regenerate")
    assert r.status_code == 200
    ev = parse_sse(r.text)
    assert ORDER_RE.match(order_code(ev))
    st = ev[0][1]
    assert st["user_message_id"] == old["user_message_id"] and st["client_msg_id"] == body["client_msg_id"]
    assert st["message_id"] != old["message_id"]
    row = db.execute("SELECT parent_id FROM messages WHERE id = ?", (st["message_id"],)).fetchone()
    assert row["parent_id"] == old["user_message_id"]
    tree = client.get(f"/api/conversations/{cid}/tree").json()
    assert tree["active_leaf_id"] == st["message_id"]
    assert len([m for m in tree["messages"] if m.get("parent_id") == old["user_message_id"]]) == 2


def test_regenerate_errors(client, run_jobs, monkeypatch):
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid)
    r = client.post("/api/messages/msg_missing/regenerate")
    assert r.status_code == 404
    r = client.post(f"/api/messages/{events[0][1]['user_message_id']}/regenerate")
    assert r.status_code == 400
    fx = load_fixture("post-messages-mid-regenerate.error")
    monkeypatch.setenv("MN_LLM_BACKEND", "openai")
    for k in ("MN_LLM_API_BASE", "MN_LLM_MODEL", "MN_LLM_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    r = client.post(f"/api/messages/{events[0][1]['message_id']}/regenerate")
    assert r.status_code == fx["status"] and r.json() == fx["body"]


def test_cancel_and_events_errors(client, run_jobs):
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid)
    fx = load_fixture("post-messages-mid-cancel.error")
    r = client.post("/api/messages/msg_missing/cancel")
    assert r.status_code == fx["status"] and r.json() == fx["body"]
    r = client.post(f"/api/messages/{events[0][1]['message_id']}/cancel")  # 已结束的回答：幂等
    assert r.json() == {"ok": True}
    assert client.get("/api/messages/msg_missing/events").status_code == 404
    assert client.get(f"/api/messages/{events[0][1]['user_message_id']}/events").status_code == 400
    # 已结束：after_seq 补发剩余事件后关闭
    r = client.get(f"/api/messages/{events[0][1]['message_id']}/events", params={"after_seq": 2})
    assert parse_sse(r.text) == events[2:]


# ---------- 分支 ----------

def test_branch_message_parent_and_context(client, db, run_jobs):
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid, "主线问题")
    aid = events[0][1]["message_id"]
    db.execute(
        "INSERT INTO branches (id, conversation_id, fork_message_id, anchor_start, anchor_end, anchor_quote, title, status, created_at) "
        "VALUES ('br_t', ?, ?, 0, 2, '这一', '分支', 'open', '2026-11-23T00:00:00Z')",
        (cid, aid),
    )
    db.commit()
    _, bev, _ = send(client, cid, "分支追问", branch_id="br_t")
    st = bev[0][1]
    assert st["branch_id"] == "br_t" and st["parent_id"] == aid
    assert client.get(f"/api/conversations/{cid}/tree").json()["active_leaf_id"] == aid  # 分支不改主线叶子
    _, bev2, _ = send(client, cid, "分支第二问", branch_id="br_t")
    assert bev2[0][1]["parent_id"] == st["message_id"]

    from app.agent.context import build_messages

    msgs = build_messages(db, project_id=client.get("/api/projects").json()["projects"][0]["id"],
                          user_message_id=bev2[0][1]["user_message_id"], scope_mode="all", web_search=False)
    users = [m["content"] for m in msgs if m["role"] == "user"]
    assert users == ["主线问题", "分支追问", "分支第二问"]
    assert all("[[E" not in m["content"] for m in msgs if m["role"] == "assistant")


# ---------- 网页 ----------

HTML = """<html><head><title>Illustrated Attention</title></head><body><article>
<h1>Illustrated Attention</h1>
<p>Attention lets every position look at every other position in the sequence when building a representation.</p>
<p>The scores are divided by the square root of the dimension of the key vectors, which leads to more stable gradients during training.</p>
<p>Finally the softmax normalizes the scores so they are all positive and add up to one before weighting the values.</p>
</article></body></html>"""


def test_search_web_then_fetch_url_creates_snapshot_evidence(client, db, run_jobs, monkeypatch):
    monkeypatch.setenv("MN_WEB_SEARCH_PROVIDER", "fake")
    from app.web import fetch as webfetch

    fetched = []

    async def fake_get(url):
        fetched.append(url)
        return 200, url, HTML

    monkeypatch.setattr(webfetch, "http_get", fake_get)
    pid, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid, "why divide by the square root of the key dimension?", web_search=True)
    assert ORDER_RE.match(order_code(events))
    kinds = [d["kind"] for e, d in events if e == "step" and d["status"] == "done"]
    assert kinds == ["search_materials", "recall_memory", "search_web", "fetch_url"]
    assert fetched == ["https://example.org/fake/one"]
    aid = events[0][1]["message_id"]
    web = [d for e, d in events if e == "evidence"]
    assert web and all(d["source_type"] == "web" for d in web)
    snap = client.get(f"/api/web_snapshots/{web[0]['source_id']}").json()
    s, e = web[0]["locator"]["char_range"]
    assert snap["text"][s:e] == web[0]["quote"] and snap["title"] == "Illustrated Attention"
    row = db.execute("SELECT captured_in_message_id FROM evidence WHERE id = ?", (web[0]["eid"],)).fetchone()
    assert row["captured_in_message_id"] == aid
    docs = [d for g in client.get(f"/api/projects/{pid}/documents").json()["groups"] if g["group"] == "web" for d in g["documents"]]
    assert len(docs) == 1 and docs[0]["snapshot_id"] == snap["id"]
    labels = [d["label"] for e, d in events if e == "step" and d["status"] == "done"]
    assert labels[2] == "联网搜索：2 个结果" and labels[3] == "抓取网页：example.org"


def test_search_web_hidden_without_provider_and_private_urls_rejected(client, run_jobs, monkeypatch):
    monkeypatch.delenv("MN_WEB_SEARCH_PROVIDER", raising=False)
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid, "看看 http://127.0.0.1:8101/secret 这个页面", web_search=True)
    done = [d for e, d in events if e == "step" and d["status"] != "running"]
    assert [d["kind"] for d in done] == ["search_materials", "recall_memory", "fetch_url"]
    assert done[2]["status"] == "error"
    assert ORDER_RE.match(order_code(events))


# ---------- 记忆、插件、Skill 经 hooks ----------

def test_memory_plugin_skill_hooks(client, db, run_jobs, monkeypatch):
    from app.agent import hooks

    finished = []

    class Mem:
        def l4_profile(self, conn, project_id):
            return "用户在学 Transformer。"

        def recall(self, conn, *, project_id, conversation_id, leaf_message_id, query, k=8):
            return [hooks.EvidenceDraft(kind="message", source_id=hist_user, quote="上次作业 3 卡在 sigmoid 饱和",
                                        locator={"message_id": hist_user, "char_range": [0, 14]}, title="反向传播 · 作业 3")]

        def on_turn_finished(self, conn, *, conversation_id, assistant_message_id):
            finished.append(assistant_message_id)

    class Plugins:
        async def list_tools(self, conn, *, conversation_id):
            return [hooks.ToolSpec("arxiv__search_papers", "搜 arXiv", {"type": "object", "properties": {}})]

        async def call_tool(self, conn, *, conversation_id, name, arguments, timeout_s=30.0):
            return hooks.ToolResult(text="找到 1 篇", evidence=[hooks.EvidenceDraft(
                kind="plugin", source_id="arxiv", quote="Attention Is All You Need (1706.03762)",
                locator={"plugin_id": "arxiv", "tool_name": "search_papers", "fields": {"id": "1706.03762"}})])

    class Skills:
        def list_enabled(self, conn, *, project_id):
            return [{"id": "pdf", "name": "pdf", "summary": "读 PDF"}]

        def load(self, conn, *, skill_id):
            return "# PDF skill\n按页阅读。" if skill_id == "pdf" else ""

    monkeypatch.setattr(hooks, "get_memory", lambda: Mem())
    monkeypatch.setattr(hooks, "get_plugins", lambda: Plugins())
    monkeypatch.setattr(hooks, "get_skills", lambda: Skills())
    _, hist_cid = setup_project(client, run_jobs, docs=[])
    _, hev, _ = send(client, hist_cid, "上次作业")
    hist_user = hev[0][1]["user_message_id"]
    finished.clear()

    _, events, _ = send(client, hist_cid, "请用 arxiv__search_papers 找论文", forced_skill="pdf")
    done = [d for e, d in events if e == "step" and d["status"] != "running"]
    assert [(d["kind"], d["label"]) for d in done] == [
        ("load_skill", "加载 Skill：pdf"),
        ("search_materials", "检索项目材料：没有命中"),
        ("recall_memory", "参考 1 段历史对话"),
        ("plugin_tool", "arxiv · search_papers"),
    ]
    evs = [d for e, d in events if e == "evidence"]
    assert [(d["source_type"], d["label"]) for d in evs] == [("message", "E1"), ("plugin", "E2")]
    aid = events[0][1]["message_id"]
    assert finished == [aid]
    row = db.execute("SELECT captured_in_message_id FROM evidence WHERE id = ?", (evs[1]["eid"],)).fetchone()
    assert row["captured_in_message_id"] == aid
    assert db.execute("SELECT tool_name FROM tool_calls WHERE message_id = ? AND step_index = 4", (aid,)).fetchone()[0] == "arxiv__search_papers"

    # 关闭记忆：不出现 recall_memory，也不调用 on_turn_finished
    client.put("/api/settings", json={"memory_enabled": False})
    finished.clear()
    _, ev2, _ = send(client, hist_cid, "再问一次")
    assert "recall_memory" not in {d["kind"] for e, d in ev2 if e == "step"} and finished == []


def test_open_source_respects_branch_path(client, db, run_jobs):
    from app.agent.loop import Turn, TurnRequest
    from app.agent.events import EventEmitter, TurnHandle
    from app.agent.tools import _open_source
    from app.llm import llm_config
    from app.llm.fake import FakeModel
    import asyncio

    pid, cid = setup_project(client, run_jobs, docs=[])
    _, a, _ = send(client, cid, "主线一")
    a1 = a[0][1]["message_id"]
    db.execute("INSERT INTO branches (id, conversation_id, fork_message_id, anchor_start, anchor_end, anchor_quote, title, status, created_at) "
               "VALUES ('br_x', ?, ?, 0, 1, 'x', 'x', 'open', '2026-11-23T00:00:00Z')", (cid, a1))
    db.commit()
    _, b, _ = send(client, cid, "分支问题", branch_id="br_x")
    branch_answer = b[0][1]["message_id"]
    _, c, _ = send(client, cid, "主线二")
    main_user = c[0][1]["user_message_id"]

    def turn_for(user_mid):
        req = TurnRequest(cid, pid, user_mid, "msg_probe", None, None, None, "q", False, {"mode": "all"}, None, None, True, llm_config(), FakeModel())
        return Turn(req=req, conn=db, em=EventEmitter(db, "msg_probe"), handle=TurnHandle("msg_probe"))

    out = asyncio.run(_open_source(turn_for(main_user), {"message_id": branch_answer}))
    assert out.error and "NOT_VISIBLE_ON_PATH" in out.text  # 兄弟分支在主线上不可见
    out = asyncio.run(_open_source(turn_for(main_user), {"message_id": a1}))
    assert not out.error and out.evidence_ids


# ---------- 设置 ----------

def test_settings_get_put(client, env):
    keys = set(load_fixture("get-settings.ok")["body"])
    r = client.get("/api/settings")
    assert r.status_code == 200 and set(r.json()) == keys and r.json()["chat_model"] == "fake-chat"
    fx = load_fixture("put-settings.ok")
    r = client.put("/api/settings", json=fx["request"]["body"])
    assert r.json()["web_search_default"] is True and set(r.json()) == keys
    fx = load_fixture("put-settings.error")
    r = client.put("/api/settings", json=fx["request"]["body"])
    assert r.status_code == fx["status"] and r.json() == fx["body"]
    r = client.put("/api/settings", json={"api_key": "sk-secret-value", "api_base": "https://api.example.com/v1"})
    assert r.json()["api_key_set"] is True and "sk-secret" not in r.text
    path = env / "data" / "settings.json"
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert client.get("/api/settings").json()["api_key_set"] is True
    assert client.put("/api/settings", json={"api_key": ""}).json()["api_key_set"] is False
    assert client.put("/api/settings", json={"nope": 1}).status_code == 400


def test_settings_drive_real_backend_config(client, monkeypatch):
    from app.llm import llm_config

    monkeypatch.setenv("MN_LLM_BACKEND", "openai")
    monkeypatch.setenv("MN_LLM_API_BASE", "https://env.example/v1")
    monkeypatch.setenv("MN_LLM_MODEL", "env-chat")
    monkeypatch.delenv("MN_LLM_SMALL_MODEL", raising=False)
    monkeypatch.delenv("MN_LLM_API_KEY", raising=False)
    assert llm_config().configured is False
    client.put("/api/settings", json={"api_key": "k", "chat_model": "set-chat", "small_model": "set-small"})
    cfg = llm_config()
    assert cfg.configured and cfg.api_base == "https://env.example/v1" and cfg.model_for("fast") == "set-small" and cfg.model_for("high") == "set-chat"


# ---------- 真实流式：断线续流与取消 ----------

@pytest.fixture
def live(env, monkeypatch):
    import uvicorn

    from app.main import create_app

    monkeypatch.setenv("MN_FAKE_LLM_DELAY_MS", "40")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(200):
        if server.started:
            break
        time.sleep(0.05)
    base = f"http://127.0.0.1:{port}"
    with httpx.Client(base_url=base, trust_env=False, timeout=30) as c:
        yield c
    server.should_exit = True
    th.join(timeout=10)


def _live_setup(c):
    from app.db.conn import connect
    from app.ingest.pipeline import run_pending_jobs

    pid = c.post("/api/projects", json={"name": "流式"}).json()["id"]
    r = c.post(f"/api/projects/{pid}/documents", files=[("file", (n, t.encode(), "text/markdown")) for n, t in DOCS])
    assert r.status_code == 200
    conn = connect()
    run_pending_jobs(conn)
    conn.close()
    return c.post(f"/api/projects/{pid}/conversations", json={}).json()["id"]


def _iter_events(resp):
    buf = ""
    for chunk in resp.iter_text():
        buf += chunk
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            parsed = parse_sse(block + "\n\n")
            if parsed:
                yield parsed[0]


def test_resume_after_disconnect(live):
    cid = _live_setup(live)
    body = {"client_msg_id": str(uuid.uuid4()), "content": QUESTION, "web_search": False, "scope": {"mode": "all"}}
    got = []
    with live.stream("POST", f"/api/conversations/{cid}/messages", json=body) as resp:
        for ev in _iter_events(resp):
            got.append(ev)
            if ev[1]["seq"] == 5:
                break  # 主动断线
    mid = got[0][1]["message_id"]
    assert got[-1][0] != "message.end"
    rest = parse_sse(live.get(f"/api/messages/{mid}/events", params={"after_seq": 5}).text)
    assert rest[0][1]["seq"] == 6 and rest[-1][0] == "message.end"
    full = got + rest
    assert [d["seq"] for _, d in full] == list(range(1, len(full) + 1))  # 无缺无重
    assert ORDER_RE.match(order_code(full))
    assert parse_sse(live.get(f"/api/messages/{mid}/events").text) == full
    # 断线前未收到 message.start 的情形：同一个 client_msg_id 重发得到同一条消息的完整事件流
    again = parse_sse(live.post(f"/api/conversations/{cid}/messages", json=body).text)
    assert again == full


def test_cancel_mid_generation(live):
    cid = _live_setup(live)
    body = {"client_msg_id": str(uuid.uuid4()), "content": QUESTION, "web_search": False, "scope": {"mode": "all"}}
    got = []
    cancelled = False
    with live.stream("POST", f"/api/conversations/{cid}/messages", json=body) as resp:
        for ev in _iter_events(resp):
            got.append(ev)
            if ev[0] == "delta" and "[[E1]]" in ev[1]["text"] and not cancelled:
                assert live.post(f"/api/messages/{got[0][1]['message_id']}/cancel").json() == {"ok": True}
                cancelled = True
    assert cancelled
    code = order_code(got)
    assert ORDER_RE.match(code), code
    end = got[-1][1]
    assert got[-1][0] == "message.end" and end["cancelled"] is True
    cits = [d for e, d in got if e == "citation"]
    assert cits and all(c["verdict"] == "partial" for c in cits)
    assert "[[E3]]" not in "".join(d["text"] for e, d in got if e == "delta")  # 生成确实停在中途
    tree = live.get(f"/api/conversations/{cid}/tree").json()
    msg = [m for m in tree["messages"] if m["id"] == end["message_id"]][0]
    assert msg["content"] == "".join(d["text"] for e, d in got if e == "delta")
    assert [c["verdict"] for c in msg["citations"]] == ["partial"] * len(cits)


def test_cancel_before_first_token_and_during_tools(live):
    cid = _live_setup(live)
    body = {"client_msg_id": str(uuid.uuid4()), "content": QUESTION, "web_search": False, "scope": {"mode": "all"}}
    got = []
    with live.stream("POST", f"/api/conversations/{cid}/messages", json=body) as resp:
        for ev in _iter_events(resp):
            got.append(ev)
            if ev[0] == "message.start":
                live.post(f"/api/messages/{ev[1]['message_id']}/cancel")
    assert got[-1][0] == "message.end" and got[-1][1]["cancelled"] is True
    assert ORDER_RE.match(order_code(got))
    steps = [d for e, d in got if e == "step"]
    assert all(s["status"] in ("running", "done", "error") for s in steps)
    assert "delta" not in {e for e, _ in got}


def test_orphan_stream_gets_error_and_history_without_events_is_empty(client, db, run_jobs):
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid)
    aid = events[0][1]["message_id"]
    # 模拟服务重启：只留下前 3 个事件，回合也不在运行
    db.execute("DELETE FROM message_events WHERE message_id = ? AND seq > 3", (aid,))
    db.commit()
    ev = parse_sse(client.get(f"/api/messages/{aid}/events", params={"after_seq": 3}).text)
    assert [e for e, _ in ev] == ["error"] and ev[0][1]["seq"] == 4 and ev[0][1]["retriable"] is True
    # 没有事件缓冲的历史回答（如种子数据）：空流直接关闭，不补 error
    db.execute("DELETE FROM message_events WHERE message_id = ?", (aid,))
    db.commit()
    assert client.get(f"/api/messages/{aid}/events").text == ""
