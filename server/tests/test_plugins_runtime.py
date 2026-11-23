"""插件运行时（B3b）：用本地假 stdio MCP 服务测启动 + tools/list 自检、调用、超时、报错、空闲回收、
工具命名空间、tools_allow、对话开关、配置与密钥、证据映射。不联网，不拉起 uvx/npx。
"""

from __future__ import annotations

import asyncio
import json
import os
import time

import pytest

from tests.b3b_support import b3b_env, fake_manifest, market_entry, write_registry  # noqa: F401

CID = "cnv_rt"


@pytest.fixture
def rt(b3b_env, client, db, monkeypatch):
    pid_file = b3b_env / "fake.pid"
    fake = fake_manifest("fake", tools_allow=["search", "note", "fetch", "slow", "boom", "env"], extra_args=["--pid-file", str(pid_file)])
    keyed = fake_manifest(
        "fakekey", tools_allow=["env"],
        env_schema={"API_KEY": {"required": True, "secret": True, "label": "Fake API Key"},
                    "REGION": {"required": False, "secret": False, "label": "区域"}},
    )
    slowstart = fake_manifest("slowstart", extra_args=["--delay", "30"])
    fetchlike = fake_manifest("fetchlike", tools_allow=["fetch"], mapping={"title": "$args.url", "url": "$args.url", "quote": "$text"})
    reg = write_registry(
        b3b_env / "registry",
        extra=[market_entry(fake, short_name="假插件"), market_entry(keyed), market_entry(slowstart), market_entry(fetchlike)],
    )
    monkeypatch.setenv("MN_REGISTRY_DIR", str(reg))
    db.execute("INSERT INTO projects (id, name, created_at) VALUES ('prj_rt', '运行时', '2026-11-23T00:00:00Z')")
    db.execute(
        "INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, 'prj_rt', 't', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')",
        (CID,),
    )
    db.commit()
    return {"client": client, "db": db, "pid_file": pid_file}


def install(client, pid, config=None):
    return client.post(f"/api/plugins/{pid}", json={"config": config or {}})


def run(coro):
    return asyncio.run(coro)


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # 僵尸进程也算已结束
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().split()[2] != "Z"
    except OSError:
        return False


def test_install_self_check_and_detail(rt):
    c = rt["client"]
    r = install(c, "fake")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "installed" and body["id"] == "fake" and body["last_check_at"]
    assert body["config_set"] == [] and body["config"] == {} and body["short_name"] == "假插件"
    d = c.get("/api/plugins/fake").json()
    names = [t["name"] for t in d["tools"]]
    assert {"search", "note", "slow", "boom", "env", "hidden"} <= set(names)  # 详情列出 tools/list 的全部工具
    assert d["manifest"]["tools_allow"] == ["search", "note", "fetch", "slow", "boom", "env"]
    assert d["verified"] is False
    assert [p["id"] for p in c.get("/api/plugins").json()["plugins"]] == ["fake"]
    market = {x["id"]: x for x in c.get("/api/market/plugins").json()["items"]}
    assert market["fake"]["installed"] is True and market["arxiv"]["installed"] is False


def test_list_tools_namespace_allow_and_conversation_toggle(rt):
    from app.agent.hooks import get_plugins

    c, db = rt["client"], rt["db"]
    assert install(c, "fake").status_code == 200
    svc = get_plugins()
    tools = run(svc.list_tools(db, conversation_id=CID))
    names = sorted(t.name for t in tools)
    assert names == ["fake__boom", "fake__env", "fake__fetch", "fake__note", "fake__search", "fake__slow"]  # hidden 被 tools_allow 挡住
    search = next(t for t in tools if t.name == "fake__search")
    assert search.input_schema["required"] == ["query"] and "Fake fake" in search.description
    # 对话里关掉
    r = c.put(f"/api/conversations/{CID}/plugins", json={"enabled_plugin_ids": []})
    assert r.status_code == 200 and r.json()["plugins"] == [{"plugin_id": "fake", "enabled": False, "status": "installed", "short_name": "假插件"}]
    assert run(svc.list_tools(db, conversation_id=CID)) == []
    res = run(svc.call_tool(db, conversation_id=CID, name="fake__search", arguments={"query": "x"}))
    assert res.is_error and "已关闭" in res.text
    # 没保存过设置的对话默认启用
    assert len(run(svc.list_tools(db, conversation_id="cnv_other"))) == 6


def test_call_tool_evidence_web_and_plugin(rt):
    from app.agent.hooks import get_plugins

    c, db = rt["client"], rt["db"]
    assert install(c, "fake").status_code == 200
    svc = get_plugins()
    res = run(svc.call_tool(db, conversation_id=CID, name="fake__search", arguments={"query": "attention"}))
    assert not res.is_error and "Attention Is All You Need" in res.text
    assert len(res.evidence) == 2
    ev = res.evidence[0]
    assert ev.kind == "web" and ev.title == "Attention Is All You Need" and ev.quote.startswith("The dominant")
    snap = db.execute("SELECT * FROM web_snapshots WHERE id = ?", (ev.source_id,)).fetchone()
    assert snap["url"] == "https://arxiv.org/pdf/1706.03762" and snap["http_status"] == 200
    s, e = ev.locator["char_range"]
    assert ev.locator["snapshot_id"] == ev.source_id and snap["text"][s:e] == ev.quote
    # 快照接口能读到（分支可见性由 B2 落库 evidence 后判断，这里只确认快照存在）
    # 无 URL 的结果 → plugin 证据
    res = run(svc.call_tool(db, conversation_id=CID, name="fake__note", arguments={"key": "bp"}))
    assert len(res.evidence) == 1
    ev = res.evidence[0]
    assert ev.kind == "plugin" and ev.source_id == "fake" and ev.quote == "反向传播按链式法则逐层求梯度。"
    assert ev.locator["plugin_id"] == "fake" and ev.locator["tool_name"] == "note"
    assert ev.locator["fields"]["tags"] == "作业3, BP" and ev.title == "笔记 bp"


def test_fetch_style_mapping_uses_args_and_text(rt):
    from app.agent.hooks import get_plugins

    c, db = rt["client"], rt["db"]
    assert install(c, "fetchlike").status_code == 200
    res = run(get_plugins().call_tool(db, conversation_id=CID, name="fetchlike__fetch", arguments={"url": "https://jalammar.github.io/illustrated-transformer/"}))
    assert not res.is_error and len(res.evidence) == 1
    ev = res.evidence[0]
    assert ev.kind == "web" and ev.title == "https://jalammar.github.io/illustrated-transformer/"
    assert "sqrt(d_k)" in ev.quote
    snap = c.get(f"/api/web_snapshots/{ev.source_id}")
    # 快照还没有被任何回合的 evidence 引用，B1 的可见性规则判为不可见（403）；行本身已写入
    assert snap.status_code in (200, 403)
    assert db.execute("SELECT COUNT(*) FROM web_snapshots WHERE id = ?", (ev.source_id,)).fetchone()[0] == 1


def test_tool_error_timeout_and_recovery(rt):
    from app.agent.hooks import get_plugins

    c, db = rt["client"], rt["db"]
    assert install(c, "fake").status_code == 200
    svc = get_plugins()
    res = run(svc.call_tool(db, conversation_id=CID, name="fake__boom", arguments={}))
    assert res.is_error and res.evidence == []
    t0 = time.monotonic()
    res = run(svc.call_tool(db, conversation_id=CID, name="fake__slow", arguments={"seconds": 5}, timeout_s=0.5))
    assert res.is_error and res.text.startswith("PLUGIN_TIMEOUT") and time.monotonic() - t0 < 4
    res = run(svc.call_tool(db, conversation_id=CID, name="fake__search", arguments={"query": "after timeout"}))
    assert not res.is_error and "after timeout" in res.text  # 超时后会话仍可用
    # 名称与开放范围
    assert run(svc.call_tool(db, conversation_id=CID, name="search", arguments={})).is_error
    assert "没有开放" in run(svc.call_tool(db, conversation_id=CID, name="fake__hidden", arguments={})).text
    assert "未安装" in run(svc.call_tool(db, conversation_id=CID, name="arxiv__search_papers", arguments={})).text


def test_idle_session_is_reaped(rt, monkeypatch):
    from app.agent.hooks import get_plugins
    from app.plugins.host import host

    c, db = rt["client"], rt["db"]
    monkeypatch.setenv("MN_PLUGIN_IDLE_S", "1")
    assert install(c, "fake").status_code == 200
    run(get_plugins().call_tool(db, conversation_id=CID, name="fake__note", arguments={"key": "k"}))
    pid = int(rt["pid_file"].read_text())
    assert "fake" in host.running() and alive(pid)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline and ("fake" in host.running() or alive(pid)):
        time.sleep(0.2)
    assert "fake" not in host.running()
    assert not alive(pid)
    # 回收后再调用会重新拉起
    res = run(get_plugins().call_tool(db, conversation_id=CID, name="fake__note", arguments={"key": "k2"}))
    assert not res.is_error and int(rt["pid_file"].read_text()) != pid


def test_self_check_failure_returns_log_tail(rt, monkeypatch):
    monkeypatch.setenv("MN_PLUGIN_START_TIMEOUT_S", "1.5")
    r = install(rt["client"], "slowstart")
    assert r.status_code == 502
    err = r.json()["error"]
    assert err["code"] == "PLUGIN_SELF_CHECK_FAILED" and err["retriable"] is True
    assert "[fake-mcp] starting server" in err["details"]["log_tail"]
    assert "[mnemosyne]" in err["details"]["log_tail"]
    assert rt["client"].get("/api/plugins/slowstart").json()["status"] == "not_installed"  # 首次安装失败不落库


def test_config_secret_merge_and_env_injection(rt):
    from app.agent.hooks import get_plugins

    c, db = rt["client"], rt["db"]
    r = install(c, "fakekey")
    assert r.status_code == 400 and "Fake API Key" in r.json()["error"]["message"]
    r = install(c, "fakekey", {"API_KEY": "sk-secret-123", "REGION": "hk"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["config_set"] == ["API_KEY", "REGION"] and body["config"] == {"REGION": "hk"}
    raw = db.execute("SELECT config_json FROM plugins WHERE id = 'fakekey'").fetchone()[0]
    assert "sk-secret-123" not in raw and json.loads(raw)["API_KEY"].startswith("enc:v1:")
    res = run(get_plugins().call_tool(db, conversation_id=CID, name="fakekey__env", arguments={"name": "API_KEY"}))
    assert res.text == "sk-secret-123"  # 配置作为环境变量注入插件进程
    # 未提供的键沿用；空字符串清除
    body = install(c, "fakekey", {"REGION": "sg"}).json()
    assert body["config_set"] == ["API_KEY", "REGION"] and body["config"] == {"REGION": "sg"}
    body = install(c, "fakekey", {"REGION": ""}).json()
    assert body["config_set"] == ["API_KEY"] and body["config"] == {}
    r = install(c, "fakekey", {"API_KEY": ""})
    assert r.status_code == 400  # 清掉必填项
    r = install(c, "fakekey", {"NOPE": "x"})
    assert r.status_code == 400 and "未知配置项" in r.json()["error"]["message"]


def test_config_change_restarts_session_and_uninstall_stops(rt):
    from app.agent.hooks import get_plugins
    from app.plugins.host import host

    c, db = rt["client"], rt["db"]
    assert install(c, "fakekey", {"API_KEY": "a"}).status_code == 200
    svc = get_plugins()
    assert run(svc.call_tool(db, conversation_id=CID, name="fakekey__env", arguments={"name": "API_KEY"})).text == "a"
    assert install(c, "fakekey", {"API_KEY": "b"}).status_code == 200
    assert run(svc.call_tool(db, conversation_id=CID, name="fakekey__env", arguments={"name": "API_KEY"})).text == "b"
    assert "fakekey" in host.running()
    assert c.delete("/api/plugins/fakekey").json() == {"ok": True}
    assert "fakekey" not in host.running()
    assert c.get("/api/plugins").json()["plugins"] == []
    assert c.delete("/api/plugins/fakekey").status_code == 404


def test_error_status_plugin_is_hidden_with_reason(rt):
    c, db = rt["client"], rt["db"]
    assert install(c, "fake").status_code == 200
    db.execute("UPDATE plugins SET status = 'error' WHERE id = 'fake'")
    db.commit()
    item = c.get(f"/api/conversations/{CID}/plugins").json()["plugins"][0]
    assert item["enabled"] is False and item["status"] == "error" and item["reason"]
    from app.agent.hooks import get_plugins

    assert run(get_plugins().list_tools(db, conversation_id=CID)) == []


def test_install_without_manifest_is_rejected(rt):
    r = install(rt["client"], "zotero")  # 市场条目存在，但没有适配清单
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert install(rt["client"], "no-such-plugin").status_code == 404


def test_secrets_roundtrip(b3b_env, client):
    from app.plugins import secrets

    enc = secrets.encrypt("密钥 value")
    assert enc.startswith("enc:v1:") and secrets.decrypt(enc) == "密钥 value"
    assert secrets.encrypt("x") != secrets.encrypt("x")  # 每次随机 nonce
    tampered = enc[:-4] + ("AAAA" if not enc.endswith("AAAA") else "BBBB")
    with pytest.raises(ValueError):
        secrets.decrypt(tampered)


def test_mapping_paths():
    from app.plugins import mapping

    rec = {"a": {"b": [{"c": 1}]}, "pdf_url": "https://x"}
    assert mapping.get_path("$.a.b[0].c", rec, {}, "") == 1
    assert mapping.get_path("$.a.x", rec, {}, "") is None
    assert mapping.get_path("$args.url", rec, {"url": "u"}, "") == "u"
    assert mapping.get_path("$text", rec, {}, "T") == "T"
    assert mapping.pick(["$.url", "$.pdf_url"], rec, {}, "") == "https://x"
    assert mapping.parse_result('{"k": 1}', {"result": '{"k": 1}'}) == {"k": 1}
    assert mapping.parse_result("not json", None) is None
    assert mapping.parse_result("", {"k": 2}) == {"k": 2}
