"""INT1 集成测试：U74 重新生成请求体、U60 插件步骤 plugin_id、U82 记忆开关、U87 只读分支拒发、记忆 llm_port 接真实模型通道。

模型一律是确定性假模型；llm_port 的“真实模型”分支用进程内桩模型代替，不访问网络、不产生费用。
"""

from __future__ import annotations

import json

import pytest

from .test_messages import DOCS, ORDER_RE, order_code, parse_sse, send, setup_project


def _tool_rows(db, aid):
    return db.execute("SELECT tool_name, args_json FROM tool_calls WHERE message_id = ? ORDER BY step_index", (aid,)).fetchall()


# ---------- U74：POST /api/messages/{mid}/regenerate 可选请求体 ----------

def test_regenerate_body_overrides_inferred_options(client, db, run_jobs, monkeypatch):
    monkeypatch.setenv("MN_WEB_SEARCH_PROVIDER", "fake")
    from app.web import fetch as webfetch

    async def fake_get(url):
        return 200, url, "<html><head><title>T</title></head><body><p>" + "Attention divides by the square root of d_k. " * 5 + "</p></body></html>"

    monkeypatch.setattr(webfetch, "http_get", fake_get)
    _, cid = setup_project(client, run_jobs)
    _, first, _ = send(client, cid)  # 原回合：全部材料、不联网
    old = first[0][1]["message_id"]

    # 请求体优先：不用材料 + 联网
    r = client.post(f"/api/messages/{old}/regenerate", json={"web_search": True, "scope": {"mode": "none"}})
    assert r.status_code == 200, r.text
    ev = parse_sse(r.text)
    assert ORDER_RE.match(order_code(ev))
    kinds = [d["kind"] for e, d in ev if e == "step" and d["status"] != "running"]
    assert "search_materials" not in kinds and "search_web" in kinds

    # 部分字段：只给 scope，联网沿用推断（原回合不联网）
    r = client.post(f"/api/messages/{old}/regenerate", json={"scope": {"mode": "selected", "document_ids": []}})
    ev = parse_sse(r.text)
    aid = ev[0][1]["message_id"]
    kinds = [d["kind"] for e, d in ev if e == "step" and d["status"] != "running"]
    assert "search_web" not in kinds and "fetch_url" not in kinds
    rows = _tool_rows(db, aid)
    sm = [json.loads(x["args_json"]) for x in rows if x["tool_name"] == "search_materials"]
    assert sm and sm[0]["scope"]["mode"] == "selected"

    # 空请求体与不带请求体：都沿用 B2 推断（全部材料、不联网）
    for kwargs in ({"json": {}}, {}):
        r = client.post(f"/api/messages/{old}/regenerate", **kwargs)
        ev = parse_sse(r.text)
        kinds = [d["kind"] for e, d in ev if e == "step" and d["status"] != "running"]
        assert kinds[0] == "search_materials" and "search_web" not in kinds

    # 字段类型不对 → 400
    r = client.post(f"/api/messages/{old}/regenerate", json={"scope": {"mode": "bogus"}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_regenerate_body_forced_skill(client, db, run_jobs, monkeypatch):
    from app.agent import hooks

    class Skills:
        def list_enabled(self, conn, *, project_id):
            return [{"id": "pdf", "name": "pdf", "summary": "读 PDF"}]

        def load(self, conn, *, skill_id):
            return "# PDF skill" if skill_id == "pdf" else ""

    monkeypatch.setattr(hooks, "get_skills", lambda: Skills())
    _, cid = setup_project(client, run_jobs, docs=[])
    _, first, _ = send(client, cid)
    r = client.post(f"/api/messages/{first[0][1]['message_id']}/regenerate", json={"forced_skill": "pdf"})
    done = [d for e, d in parse_sse(r.text) if e == "step" and d["status"] != "running"]
    assert done[0]["kind"] == "load_skill" and done[0]["label"] == "加载 Skill：pdf"


# ---------- U60：插件步骤带 plugin_id ----------

def test_plugin_step_carries_plugin_id(client, db, run_jobs, monkeypatch):
    from app.agent import hooks

    class Plugins:
        async def list_tools(self, conn, *, conversation_id):
            return [hooks.ToolSpec("arxiv__search_papers", "搜 arXiv", {"type": "object", "properties": {}})]

        async def call_tool(self, conn, *, conversation_id, name, arguments, timeout_s=30.0):
            return hooks.ToolResult(text="找到 1 篇")

    monkeypatch.setattr(hooks, "get_plugins", lambda: Plugins())
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid, "请用 arxiv__search_papers 找论文")
    steps = [d for e, d in events if e == "step"]
    plug = [s for s in steps if s["kind"] == "plugin_tool"]
    assert [s["status"] for s in plug] == ["running", "done"]
    assert all(s["plugin_id"] == "arxiv" for s in plug)
    assert all("plugin_id" not in s for s in steps if s["kind"] != "plugin_tool")  # 其他步骤省略该字段
    aid = events[0][1]["message_id"]
    tree = client.get(f"/api/conversations/{cid}/tree").json()
    am = [m for m in tree["messages"] if m["id"] == aid][0]
    assert [s.get("plugin_id") for s in am["steps"] if s["kind"] == "plugin_tool"] == ["arxiv"]
    assert all("plugin_id" not in s for s in am["steps"] if s["kind"] != "plugin_tool")


def test_plugin_id_of():
    from app.repo import plugin_id_of

    assert plugin_id_of("arxiv__search_papers") == "arxiv"
    assert plugin_id_of("search_materials") is None
    assert plugin_id_of("__x") is None
    assert plugin_id_of(None) is None


# ---------- U82：记忆开关 ----------

def test_memory_switch_wired_to_settings(client, db, run_jobs, monkeypatch):
    from app.agent import hooks
    from app.memory.service import memory

    assert memory.enabled(db) is True
    client.put("/api/settings", json={"memory_enabled": False})
    assert memory.enabled(db) is False  # B3a 的 enabled_check 读 B2 的设置
    client.put("/api/settings", json={"memory_enabled": True})
    assert memory.enabled(db) is True

    calls = []

    class Spy:
        def l4_profile(self, conn, project_id):
            return ""

        def recall(self, conn, **kw):
            calls.append("recall")
            return []

        def on_turn_finished(self, conn, **kw):
            calls.append("finished")

    monkeypatch.setattr(hooks, "get_memory", lambda: Spy())
    _, cid = setup_project(client, run_jobs, docs=[])
    send(client, cid, "第一问")
    assert calls == ["recall", "finished"]
    calls.clear()
    client.put("/api/settings", json={"memory_enabled": False})
    _, events, _ = send(client, cid, "第二问")
    assert calls == []  # 关闭后回合不调用 recall / on_turn_finished
    assert "recall_memory" not in {d["kind"] for e, d in events if e == "step"}


def test_memory_switch_off_skips_extract_jobs(client, db, run_jobs):
    """真实记忆服务：关闭开关后 on_turn_finished 不写 extract_memory 任务。"""
    client.put("/api/settings", json={"memory_enabled": False})
    _, cid = setup_project(client, run_jobs, docs=[])
    send(client, cid, "我喜欢先看结论再看推导")
    n = db.execute("SELECT COUNT(*) FROM jobs WHERE kind = 'extract_memory'").fetchone()[0]
    assert n == 0
    client.put("/api/settings", json={"memory_enabled": True})
    send(client, cid, "我喜欢先看结论再看推导")
    assert db.execute("SELECT COUNT(*) FROM jobs WHERE kind = 'extract_memory'").fetchone()[0] == 1


# ---------- U87：向 merged / archived 分支发消息 ----------

def _branch(db, cid, aid, bid, status):
    db.execute(
        "INSERT INTO branches (id, conversation_id, fork_message_id, anchor_start, anchor_end, anchor_quote, title, status, created_at) "
        "VALUES (?, ?, ?, 0, 2, '这一', '分支', ?, '2026-11-23T00:00:00Z')",
        (bid, cid, aid, status),
    )
    db.commit()


@pytest.mark.parametrize("status", ["merged", "archived"])
def test_send_to_closed_branch_rejected(client, db, run_jobs, status):
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid, "主线问题")
    aid = events[0][1]["message_id"]
    _branch(db, cid, aid, "br_open", "open")
    _, bev, _ = send(client, cid, "分支追问", branch_id="br_open")
    branch_answer = bev[0][1]["message_id"]
    db.execute("UPDATE branches SET status = ? WHERE id = 'br_open'", (status,))
    db.commit()
    n = db.execute("SELECT COUNT(*) FROM messages").fetchone()[0]

    r, _, _ = send(client, cid, "再问", branch_id="br_open")
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "VALIDATION_ERROR" and err["retriable"] is False and err["details"] == {"branch_status": status}
    # 只给 parent_id（分支里的消息）也一样拒绝
    r, _, _ = send(client, cid, "再问", parent_id=branch_answer)
    assert r.status_code == 400 and r.json()["error"]["details"] == {"branch_status": status}
    # 只读分支里的回答也不能重新生成
    r = client.post(f"/api/messages/{branch_answer}/regenerate")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert db.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == n  # 没有落库任何消息
    # 主线不受影响
    r, ev, _ = send(client, cid, "主线继续")
    assert r.status_code == 200 and ORDER_RE.match(order_code(ev))


def test_send_after_merge_api_rejected(client, db, run_jobs):
    """走真实分支接口：开分支 → 追问 → 合并 → 再发被拒。"""
    _, cid = setup_project(client, run_jobs)
    _, events, _ = send(client, cid)
    aid = events[0][1]["message_id"]
    b = client.post("/api/branches", json={"conversation_id": cid, "fork_message_id": aid, "anchor": {"start": 0, "end": 4, "quote": "根据这一"}})
    assert b.status_code == 200, b.text
    bid = b.json()["id"]
    r, bev, _ = send(client, cid, "追问", branch_id=bid)
    assert r.status_code == 200 and ORDER_RE.match(order_code(bev))
    assert client.post(f"/api/branches/{bid}/merge").status_code == 200
    r, _, _ = send(client, cid, "合并后再问", branch_id=bid)
    assert r.status_code == 400 and r.json()["error"]["details"] == {"branch_status": "merged"}


# ---------- 记忆 llm_port：配置了真实模型时调用 app.llm ----------

class _StubModel:
    def __init__(self, text):
        self.text = text
        self.calls = []

    async def complete(self, messages, *, model):
        self.calls.append((model, messages[-1]["content"]))
        if isinstance(self.text, Exception):
            raise self.text
        return self.text, (10, 5)


def _real_cfg(monkeypatch, stub):
    import app.llm as llm

    monkeypatch.setenv("MN_LLM_BACKEND", "openai")
    monkeypatch.setenv("MN_LLM_API_BASE", "http://stub.invalid/v1")
    monkeypatch.setenv("MN_LLM_MODEL", "stub-chat")
    monkeypatch.setenv("MN_LLM_SMALL_MODEL", "stub-small")
    monkeypatch.setenv("MN_LLM_API_KEY", "x")
    monkeypatch.setattr(llm, "get_model", lambda cfg=None: stub)


def test_llm_port_fake_by_default(env, monkeypatch):
    from app.memory import llm_port

    monkeypatch.delenv("MN_LLM_BACKEND", raising=False)
    data = {"title": "t", "anchor_quote": "q", "turns": [{"user": "问", "assistant": "答一句。"}]}
    out = llm_port.complete_json("merge", llm_port.build_prompt("merge", data), data=data)
    assert out["content"].startswith("分支「t」要点：")


def test_llm_port_uses_real_model_when_configured(env, monkeypatch):
    from app.memory import llm_port

    stub = _StubModel('```json\n{"content": "分支「t」要点：真实模型写的。"}\n```')
    _real_cfg(monkeypatch, stub)
    data = {"title": "t", "anchor_quote": "q", "turns": []}
    out = llm_port.complete_json("merge", llm_port.build_prompt("merge", data), data=data)
    assert out == {"content": "分支「t」要点：真实模型写的。"}
    assert stub.calls[0][0] == "stub-small" and "只输出一个 JSON 对象" in stub.calls[0][1]

    stub2 = _StubModel('好的：{"action": "SUPERSEDE", "target_id": "mem_1", "content": "改喜欢 B"}')
    _real_cfg(monkeypatch, stub2)
    jd = {"candidate": {"topic": "x", "content": "喜欢 B"}, "existing": [{"id": "mem_1", "topic": "x", "content": "喜欢 A"}]}
    assert llm_port.complete_json("judge", llm_port.build_prompt("judge", jd), data=jd)["action"] == "SUPERSEDE"


@pytest.mark.parametrize("reply", ["不是 JSON", '{"action": "MAYBE"}', '{"candidates": "x"}', RuntimeError("boom")])
def test_llm_port_falls_back_to_rules(env, monkeypatch, reply):
    from app.llm import ModelError
    from app.memory import llm_port

    stub = _StubModel(reply if not isinstance(reply, RuntimeError) else ModelError("down"))
    _real_cfg(monkeypatch, stub)
    jd = {"candidate": {"topic": "x", "content": "喜欢 B"}, "existing": []}
    out = llm_port.complete_json("judge", llm_port.build_prompt("judge", jd), data=jd)
    assert out["action"] in ("ADD", "UPDATE", "SUPERSEDE", "NOOP")  # 规则实现给出合法结果
    ed = {"user": "我喜欢先看结论", "assistant": "好", "user_message_id": "msg_u", "assistant_message_id": "msg_a"}
    out = llm_port.complete_json("extract", llm_port.build_prompt("extract", ed), data=ed)
    assert isinstance(out["candidates"], list)
    assert stub.calls  # 确实先试了“真实模型”


def test_llm_port_not_configured_stays_fake(env, monkeypatch):
    import app.llm as llm
    from app.memory import llm_port

    monkeypatch.setenv("MN_LLM_BACKEND", "openai")
    for k in ("MN_LLM_API_BASE", "MN_LLM_MODEL", "MN_LLM_API_KEY", "MN_LLM_SMALL_MODEL"):
        monkeypatch.delenv(k, raising=False)

    def boom(cfg=None):
        raise AssertionError("未配置时不应创建模型")

    monkeypatch.setattr(llm, "get_model", boom)
    data = {"title": "t", "anchor_quote": "q", "turns": []}
    assert llm_port.complete_json("merge", llm_port.build_prompt("merge", data), data=data)["content"].startswith("分支「t」")


assert DOCS  # 复用 B2 的测试材料
