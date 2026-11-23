"""BYOK：用户自带模型密钥。

覆盖：未配置=演示模式（假模型）、保存设置后自动启用真实模型、MN_LLM_BACKEND=fake 强制假模型、服务商预设、
测试连接（POST /api/settings/test）、密钥只写不读（掩码、0600、日志/错误/SSE/数据库里都搜不到密钥）、
运行时 401/402/429/超时/流式中途错误的中文提示、记忆 llm_port 与评测读同一份设置。

所有“真实模型”请求都经 httpx.MockTransport，不访问外网、不发任何付费请求。
"""

from __future__ import annotations

import json
import logging
import os
import stat
import sys
from pathlib import Path

import httpx
import pytest

from .conftest import load_fixture
from .test_messages import send, setup_project

KEY = "sk-byok-SECRET-0123456789abcd"  # 测试用假密钥（长度 ≥ 12，会给掩码）
KEY_TAIL = KEY[-4:]


# ---------- 工具 ----------

def _configure(client, **over):
    body = {"provider": "custom", "api_base": "https://llm.test/v1", "api_key": KEY, "chat_model": "m-chat", "small_model": "m-small"}
    body.update(over)
    r = client.put("/api/settings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


class Recorder:
    """记录发出的请求；handler(request) 决定响应。"""

    def __init__(self, handler):
        self.handler = handler
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)

    def bodies(self):
        return [json.loads(r.content) for r in self.requests if r.content]


def _patch_model_transport(monkeypatch, rec: Recorder):
    from app.llm import openai_compat

    transport = httpx.MockTransport(rec)
    orig_init = openai_compat.OpenAICompatModel.__init__

    def init(self, api_base, api_key, transport_=None, **kw):
        orig_init(self, api_base, api_key, transport, **kw)

    monkeypatch.setattr(openai_compat.OpenAICompatModel, "__init__", init)


def _sse_ok(text="这是来自真实模型的回答。"):
    chunks = [
        {"choices": [{"delta": {"content": text}}]},
        {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 7}},
    ]
    body = "".join(f"data: {json.dumps(c, ensure_ascii=False)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)


def _ok_handler(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    if body.get("stream"):
        return _sse_ok()
    return httpx.Response(200, json={"choices": [{"message": {"content": "真实标题"}}], "usage": {"prompt_tokens": 3, "completion_tokens": 2}})


def _assert_no_key(*texts):
    for t in texts:
        assert KEY not in t
        assert KEY[:8] not in t or KEY[:8] == "sk-byok-"  # 前缀本身不是秘密
        assert "SECRET-0123456789" not in t


# ---------- 自动启用 / 演示模式 ----------

def test_unconfigured_is_demo_mode(client):
    from app.llm import get_model, llm_config
    from app.llm.fake import FakeModel

    s = client.get("/api/settings").json()
    assert s["llm_mode"] == "demo" and s["api_key_set"] is False and s["chat_model"] == "" and "api_key_hint" not in s
    assert s["retrieval_mode"] == "local" and s["provider"] == "custom"
    assert llm_config().backend == "fake" and isinstance(get_model(), FakeModel)
    # 只填了一部分（缺对话模型）仍是演示模式
    client.put("/api/settings", json={"api_base": "https://llm.test/v1", "api_key": KEY})
    assert client.get("/api/settings").json()["llm_mode"] == "demo"


def test_saved_settings_auto_enable_real_model(client):
    from app.llm import get_model, llm_config
    from app.llm.openai_compat import OpenAICompatModel

    s = _configure(client)
    assert s["llm_mode"] == "real" and s["chat_model"] == "m-chat" and s["small_model"] == "m-small"
    cfg = llm_config()
    assert cfg.backend == "openai" and cfg.api_base == "https://llm.test/v1" and cfg.model_for("fast") == "m-small"
    m = get_model(cfg)
    assert isinstance(m, OpenAICompatModel) and KEY not in repr(m)


def test_env_fake_forces_demo(client, monkeypatch):
    from app.llm import llm_config

    _configure(client)
    monkeypatch.setenv("MN_LLM_BACKEND", "fake")
    assert llm_config().backend == "fake"
    assert client.get("/api/settings").json()["llm_mode"] == "demo_forced"


def test_provider_presets_listed_and_applied(client):
    from app.llm import llm_config

    r = client.get("/api/settings/providers")
    assert r.status_code == 200
    ps = {p["id"]: p for p in r.json()["providers"]}
    assert list(ps) == ["openai", "deepseek", "openrouter", "custom"]
    assert ps["deepseek"]["supports_embeddings"] is False and ps["deepseek"]["embedding_model"] == ""
    assert all(p["doc_urls"] for k, p in ps.items() if k != "custom")
    _configure(client, provider="deepseek", api_base="https://api.deepseek.com", chat_model="deepseek-v4-pro", small_model="deepseek-flash")
    cfg = llm_config()
    assert cfg.provider == "deepseek" and cfg.extra_body == {"thinking": {"type": "disabled"}}
    # 选了“自定义”但填的是 OpenAI 官方地址：按地址认出 openai，带工具调 gpt-6-luna 时加 reasoning_effort=none
    _configure(client, provider="custom", api_base="https://api.openai.com/v1", chat_model="gpt-6.2-sol", small_model="gpt-6-luna")
    cfg = llm_config()
    assert cfg.tool_extra == {"gpt-6-luna": {"reasoning_effort": "none"}}
    # 选了预设但地址改成别处：不套预设参数
    _configure(client, provider="deepseek", api_base="https://proxy.example/v1")
    assert llm_config().extra_body == {}
    assert client.put("/api/settings", json={"provider": "nope"}).status_code == 400


# ---------- 密钥只写不读 ----------

def test_key_never_returned_and_file_0600(client, env, caplog):
    caplog.set_level(logging.DEBUG)
    s = _configure(client)
    assert s["api_key_set"] is True and s["api_key_hint"] == f"••••{KEY_TAIL}"
    r = client.get("/api/settings")
    _assert_no_key(r.text)
    path = env / "data" / "settings.json"
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    # 短密钥不给掩码
    s = client.put("/api/settings", json={"api_key": "short-key"}).json()
    assert s["api_key_set"] is True and "api_key_hint" not in s
    # 清除
    s = client.put("/api/settings", json={"api_key": ""}).json()
    assert s["api_key_set"] is False and s["llm_mode"] == "demo"
    # 前端整份回传只读字段时忽略
    assert client.put("/api/settings", json={"api_key_hint": "x", "llm_mode": "real", "retrieval_mode": "x"}).status_code == 200
    _assert_no_key(caplog.text)


def test_redact():
    from app.llm.errors import redact

    t = f'{{"error": "Incorrect API key provided: {KEY}. Authorization: Bearer {KEY}"}}'
    out = redact(t, KEY)
    _assert_no_key(out)
    assert "sk-proj-abcdefghij" not in redact("key sk-proj-abcdefghijkl leaked")
    assert redact("authorization=abcdef123456") == "authorization=[已隐藏]"


# ---------- 运行时报错（真实模型回合） ----------

def _turn_with(client, run_jobs, monkeypatch, handler):
    rec = Recorder(handler)
    _patch_model_transport(monkeypatch, rec)
    _configure(client)
    _, cid = setup_project(client, run_jobs, docs=[])
    r, events, _ = send(client, cid)
    assert r.status_code == 200, r.text
    return r, events, rec


@pytest.mark.parametrize(
    "status,body,expect,retriable",
    [
        (401, {"error": {"message": f"Incorrect API key provided: {KEY}", "type": "invalid_request_error", "code": "invalid_api_key"}}, "密钥无效", False),
        (402, {"error": {"message": "Insufficient Balance"}}, "余额不足", False),
        (429, {"error": {"message": "You exceeded your current quota", "type": "insufficient_quota", "code": "credit_balance_exhausted"}}, "余额不足", False),
        (429, {"error": {"message": "Rate limit reached", "type": "rate_limit_error"}}, "限流", True),
        (404, {"error": {"message": "The model `m-chat` does not exist", "code": "model_not_found"}}, "模型不存在", False),
        (503, {"error": {"message": "overloaded"}}, "暂时不可用", True),
        (400, {"error": {"message": f"tools is not supported for this model (key {KEY})"}}, "拒绝了这次请求", False),
    ],
)
def test_runtime_http_errors_end_turn_with_chinese_hint(client, db, run_jobs, monkeypatch, caplog, status, body, expect, retriable):
    caplog.set_level(logging.DEBUG)
    r, events, rec = _turn_with(client, run_jobs, monkeypatch, lambda req: httpx.Response(status, json=body))
    kinds = [e for e, _ in events]
    assert kinds[0] == "message.start" and kinds[-1] == "error" and "message.end" not in kinds
    err = events[-1][1]
    assert err["code"] == "MODEL_UNAVAILABLE" and expect in err["message"] and err["retriable"] is retriable
    assert f"HTTP {status}" in err["message"]
    if status == 400:
        assert "tools is not supported" in err["message"]  # 400 附脱敏后的上游摘要
    # 请求确实带着密钥发出去了，但密钥不出现在 SSE、日志、数据库事件里
    assert rec.requests and rec.requests[0].headers["authorization"] == f"Bearer {KEY}"
    stored = " ".join(row[0] for row in db.execute("SELECT data_json FROM message_events").fetchall())
    _assert_no_key(r.text, caplog.text, stored)


@pytest.mark.parametrize("exc,expect", [(httpx.ReadTimeout("read timed out"), "超时"), (httpx.ConnectError("connection refused"), "连不上")])
def test_runtime_network_errors(client, run_jobs, monkeypatch, exc, expect):
    def boom(req):
        raise exc

    _, events, _ = _turn_with(client, run_jobs, monkeypatch, boom)
    err = events[-1][1]
    assert events[-1][0] == "error" and expect in err["message"] and err["retriable"] is True


def test_runtime_midstream_error_openrouter_style(client, run_jobs, monkeypatch):
    def handler(req):
        chunks = [
            {"choices": [{"delta": {"content": "前半句"}}]},
            {"error": {"code": 402, "message": "insufficient credits", "metadata": {"error_type": "payment_required"}}, "choices": [{"finish_reason": "error", "delta": {}}]},
        ]
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text="".join(f"data: {json.dumps(c)}\n\n" for c in chunks))

    _, events, _ = _turn_with(client, run_jobs, monkeypatch, handler)
    assert events[-1][0] == "error" and "余额不足" in events[-1][1]["message"]


def test_real_model_turn_success_sends_preset_fields(client, db, run_jobs, monkeypatch):
    rec = Recorder(_ok_handler)
    _patch_model_transport(monkeypatch, rec)
    _configure(client, provider="deepseek", api_base="https://api.deepseek.com", chat_model="deepseek-v4-pro", small_model="deepseek-flash")
    _, cid = setup_project(client, run_jobs, docs=[])
    r, events, _ = send(client, cid)
    kinds = [e for e, _ in events]
    assert kinds[-1] == "message.end", events[-1]
    text = "".join(d["text"] for e, d in events if e == "delta")
    assert "真实模型的回答" in text
    aid = events[0][1]["message_id"]
    assert db.execute("SELECT model FROM messages WHERE id = ?", (aid,)).fetchone()["model"] == "deepseek-v4-pro"
    streamed = [b for b in rec.bodies() if b.get("stream")]
    assert streamed and streamed[0]["model"] == "deepseek-v4-pro" and streamed[0]["thinking"] == {"type": "disabled"}
    assert all(str(req.url).startswith("https://api.deepseek.com/chat/completions") for req in rec.requests)


def test_demo_mode_turn_does_not_touch_network(client, run_jobs, monkeypatch):
    def never(req):
        raise AssertionError("演示模式不应发出模型请求")

    _patch_model_transport(monkeypatch, Recorder(never))
    _, cid = setup_project(client, run_jobs, docs=[])
    _, events, _ = send(client, cid)
    assert events[-1][0] == "message.end"


# ---------- 测试连接 ----------

@pytest.fixture
def test_transport():
    from app.api import settings as api

    holder = {}

    def install(handler):
        rec = Recorder(handler)
        api.set_test_transport(httpx.MockTransport(rec))
        holder["rec"] = rec
        return rec

    yield install
    api.set_test_transport(None)


def _models(*ids, params=None):
    data = []
    for i in ids:
        m = {"id": i, "object": "model"}
        if params is not None:
            m["supported_parameters"] = params
        data.append(m)
    return {"object": "list", "data": data}


def test_settings_test_ok_lists_models_without_billing(client, test_transport, caplog):
    caplog.set_level(logging.DEBUG)
    rec = test_transport(lambda req: httpx.Response(200, json=_models("m-chat", "m-small")))
    r = client.post("/api/settings/test", json={"api_base": "https://llm.test/v1", "api_key": KEY, "chat_model": "m-chat", "small_model": "m-small"})
    assert r.status_code == 200
    out = r.json()
    assert out["ok"] is True and out["code"] == "ok" and isinstance(out["latency_ms"], int)
    assert [req.method + " " + req.url.path for req in rec.requests] == ["GET /v1/models"]  # 只列模型，不发补全
    _assert_no_key(r.text, caplog.text)


def test_settings_test_uses_saved_key_and_reports_errors(client, test_transport):
    _configure(client)
    rec = test_transport(lambda req: httpx.Response(401, json={"error": {"message": f"bad key {KEY}"}}))
    out = client.post("/api/settings/test", json={}).json()
    assert rec.requests[0].headers["authorization"] == f"Bearer {KEY}"
    assert out["ok"] is False and out["code"] == "key_invalid" and "密钥无效" in out["message"]
    _assert_no_key(json.dumps(out, ensure_ascii=False))

    test_transport(lambda req: httpx.Response(200, json=_models("other")))
    out = client.post("/api/settings/test", json={}).json()
    assert out["code"] == "model_not_found" and "m-chat" in out["message"]

    def refuse(req):
        raise httpx.ConnectError("refused")

    test_transport(refuse)
    out = client.post("/api/settings/test", json={"api_base": "http://127.0.0.1:9/v1"}).json()
    assert out["code"] == "unreachable" and "连不上" in out["message"]

    def slow(req):
        raise httpx.ConnectTimeout("timeout")

    test_transport(slow)
    assert client.post("/api/settings/test", json={}).json()["code"] == "timeout"


def test_settings_test_falls_back_to_one_token(client, test_transport):
    def handler(req):
        if req.url.path.endswith("/models"):
            return httpx.Response(404, json={"error": {"message": "not found"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": "p"}}]})

    rec = test_transport(handler)
    out = client.post("/api/settings/test", json={"api_base": "http://local.test/v1", "api_key": KEY, "chat_model": "m-chat"}).json()
    assert out["ok"] is True
    post = [json.loads(r.content) for r in rec.requests if r.method == "POST"]
    assert post == [{"model": "m-chat", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}]


def test_settings_test_openrouter_key_and_tools(client, test_transport):
    base = "https://openrouter.ai/api/v1"

    def handler_badkey(req):
        if req.url.path.endswith("/key"):
            return httpx.Response(401, json={"error": {"code": 401, "message": "No auth credentials found"}})
        return httpx.Response(200, json=_models("openai/gpt-6.2-sol"))

    test_transport(handler_badkey)
    out = client.post("/api/settings/test", json={"provider": "openrouter", "api_base": base, "api_key": KEY, "chat_model": "openai/gpt-6.2-sol", "small_model": ""}).json()
    assert out["code"] == "key_invalid"

    def handler_notools(req):
        if req.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {"label": "x"}})
        assert "output_modalities=all" in str(req.url)
        return httpx.Response(200, json=_models("vendor/no-tools", params=["temperature", "max_tokens"]))

    test_transport(handler_notools)
    out = client.post("/api/settings/test", json={"provider": "openrouter", "api_base": base, "api_key": KEY, "chat_model": "vendor/no-tools", "small_model": ""}).json()
    assert out["ok"] is False and out["code"] == "tools_unsupported" and out["tool_calls"] == "unsupported"


def test_settings_test_validation_and_missing(client, test_transport):
    test_transport(lambda req: httpx.Response(500))
    out = client.post("/api/settings/test", json={}).json()
    assert out["ok"] is False and out["code"] == "not_configured" and "API Key" in out["message"]
    assert client.post("/api/settings/test", json={"api_base": "ftp://x"}).status_code == 400
    assert client.post("/api/settings/test", json={"provider": "nope"}).status_code == 400
    assert client.post("/api/settings/test", json={"nope": 1}).status_code == 400


def test_settings_test_embedding_without_preset_support(client, test_transport):
    test_transport(lambda req: httpx.Response(200, json=_models("deepseek-v4-pro", "deepseek-flash")))
    out = client.post(
        "/api/settings/test",
        json={"provider": "deepseek", "api_base": "https://api.deepseek.com", "api_key": KEY, "chat_model": "deepseek-v4-pro", "small_model": "deepseek-flash", "embedding_model": ""},
    ).json()
    assert out["ok"] is True and out["embeddings"] == "not_used" and out["tool_calls"] == "supported"


# ---------- 记忆与评测读同一份设置 ----------

def test_llm_port_reads_saved_settings(client, monkeypatch):
    import app.llm as llm
    from app.memory import llm_port

    assert llm_port._real_model() is None  # 演示模式
    _configure(client)
    monkeypatch.setattr(llm, "get_model", lambda cfg=None: object())
    real = llm_port._real_model()
    assert real is not None and real[1] == "m-small"


def test_eval_reads_saved_settings(client, env, monkeypatch, tmp_path):
    from app.llm.settings import llm_config

    _configure(client)
    scripts = Path(__file__).resolve().parents[1] / "scripts"
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    from eval_lib.backend import MnemosyneBackendAdapter
    from eval_lib.llm import user_llm_settings

    assert user_llm_settings() == ("https://llm.test/v1", KEY)
    for k in ("MN_DATA_DIR", "MN_LLM_BACKEND", "MN_SETTINGS_PATH", "MN_EVAL_CHAT_MODEL", "MN_EMBED_BACKEND", "MN_DB_PATH"):
        monkeypatch.setenv(k, os.environ.get(k, ""))
    monkeypatch.setenv("MN_EVAL_ALLOW_PAID", "1")
    MnemosyneBackendAdapter(model="eval-chat", data_dir=tmp_path / "evaldata")
    monkeypatch.setenv("MN_DATA_DIR", str(tmp_path / "evaldata" / "items" / "x"))  # 每题换数据目录后仍读同一份设置
    cfg = llm_config()
    assert cfg.backend == "openai" and cfg.chat_model == "eval-chat" and cfg.small_model == "m-small" and cfg.api_key == KEY


# ---------- 契约 fixtures ----------

def test_contract_fixtures_match_backend(client, test_transport):
    fx = load_fixture("get-settings-providers.ok")
    assert client.get("/api/settings/providers").json() == fx["body"]  # 前端 mock 与后端预设逐字段一致
    fx = load_fixture("post-settings-test.error")
    r = client.post("/api/settings/test", json=fx["request"]["body"])
    assert r.status_code == fx["status"] and r.json() == fx["body"]
    demo = load_fixture("get-settings.demo.ok")["body"]
    assert client.get("/api/settings").json() == demo
    keys = set(load_fixture("post-settings-test.ok")["body"])
    test_transport(lambda req: httpx.Response(200, json=_models("m-chat")))
    out = client.post("/api/settings/test", json={"api_base": "https://llm.test/v1", "api_key": KEY, "chat_model": "m-chat"}).json()
    assert set(out) == keys
