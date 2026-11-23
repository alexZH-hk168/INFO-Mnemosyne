"""B3a 契约比对：分支与记忆接口逐份读取 docs/contract/fixtures/ 的样例，按样例 request 发请求，
比对状态码、错误码与 retriable、响应结构（契约模型 extra=forbid + 样例里每个键在响应里同类型出现）。做法与 B1 的 test_contract_fixtures 相同。
"""

from __future__ import annotations

import json
import sqlite3

import pytest
from pydantic import TypeAdapter

from app import models as m
from tests.conftest import FIXTURES, load_fixture
from tests.seed import seed_world
from tests.test_contract_fixtures import assert_shape, build_request

RESPONSE_MODEL = {
    "POST /api/branches": m.Branch,
    "POST /api/branches/{bid}/merge": m.MergeResult,
    "PUT /api/branches/{bid}": m.Branch,
    "GET /api/memory/items": m.MemoryItemList,
    "PUT /api/memory/items/{id}": m.MemoryItem,
    "DELETE /api/memory/items/{id}": m.OkResult,
    "GET /api/memory/summary": m.MemorySummary,
}


def _names() -> list[str]:
    out = []
    for p in sorted(FIXTURES.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if data.get("endpoint") in RESPONSE_MODEL and data.get("kind") in ("ok", "error"):
            out.append(p.stem)
    return out


NAMES = _names()


def test_fixture_inventory():
    eps: dict[str, set] = {}
    for n in NAMES:
        d = load_fixture(n)
        eps.setdefault(d["endpoint"], set()).add(d["kind"])
    assert set(eps) == set(RESPONSE_MODEL)
    assert all(k == {"ok", "error"} for k in eps.values()), eps


@pytest.fixture
def world(client, db, env):
    from app.config import get_config

    seed_world(db, get_config().files_dir)
    for it in load_fixture("get-memory-items.ok")["body"]["items"]:
        db.execute(
            "INSERT INTO memory_items (id, scope, scope_id, topic, content, source_message_ids_json, status, valid_from, valid_to, "
            "confidence, created_at, source_conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (it["id"], it["scope"], it.get("scope_id"), it["topic"], it["content"], json.dumps(it["source_message_ids"]), it["status"],
             it.get("valid_from"), it.get("valid_to"), it["confidence"], it.get("valid_from"), it.get("source_conversation_id")),
        )
    s = load_fixture("get-memory-summary.ok")["body"]
    db.execute("INSERT INTO memory_summaries (id, scope, scope_id, content, version, updated_at) VALUES ('msum_seed', 'project', 'prj_dlintro', ?, ?, ?)",
               (s["content"], s["version"], s["updated_at"]))
    db.commit()
    return db


@pytest.mark.parametrize("name", NAMES)
def test_fixture_contract(name, client, world, monkeypatch):
    fx = load_fixture(name)
    if name == "get-memory-summary.error":
        from app.memory import store

        def boom(*_a, **_k):
            raise sqlite3.OperationalError("disk I/O error")

        monkeypatch.setattr(store, "current_summary", boom)
    method, url, kwargs = build_request(fx)
    resp = client.request(method, url, **kwargs)
    assert resp.status_code == fx["status"], resp.text
    body = resp.json()
    if fx["kind"] == "error":
        m.ApiErrorBody.model_validate(fx["body"])
        m.ApiErrorBody.model_validate(body)
        assert body["error"]["code"] == fx["body"]["error"]["code"]
        assert body["error"]["retriable"] == fx["body"]["error"]["retriable"]
        assert body["error"]["message"]
        return
    model = RESPONSE_MODEL[fx["endpoint"]]
    TypeAdapter(model).validate_python(fx["body"])
    model.model_validate(body)
    assert_shape(fx["body"], body)


def test_memory_items_equal_fixture(client, world):
    fx = load_fixture("get-memory-items.ok")
    body = client.get("/api/memory/items", params=fx["request"]["query"]).json()
    by_id = lambda xs: sorted(xs, key=lambda x: x["id"])  # noqa: E731
    assert by_id(body["items"]) == by_id(fx["body"]["items"])


def test_put_memory_item_equals_fixture(client, world):
    fx = load_fixture("put-memory-items-id.ok")
    body = client.put("/api/memory/items/mem_hw3_sigmoid", json=fx["request"]["body"]).json()
    assert body == fx["body"]


def test_summary_equals_fixture(client, world):
    assert client.get("/api/memory/summary").json() == load_fixture("get-memory-summary.ok")["body"]


def test_branch_fixtures_semantics(client, world):
    """除结构外，逐字段核对与种子世界一致、与时间和新 id 无关的字段。"""
    fx = load_fixture("post-branches.ok")
    b = client.post("/api/branches", json=fx["request"]["body"]).json()
    for k in ("conversation_id", "fork_message_id", "anchor_start", "anchor_end", "anchor_quote", "status", "context_turns"):
        assert b[k] == fx["body"][k], k
    assert b["title"] == fx["body"]["anchor_quote"].strip()[:12]  # U48：标题由后端取前 12 字（fixture 写的是整句，只比结构）

    fx = load_fixture("put-branches-bid.ok")
    assert client.put("/api/branches/br_onehot", json=fx["request"]["body"]).json() == fx["body"]
    fx = load_fixture("put-branches-bid.rename.ok")
    assert client.put("/api/branches/br_variance", json=fx["request"]["body"]).json() == fx["body"]

    fx = load_fixture("post-branches-bid-merge.ok")
    r = client.post("/api/branches/br_variance/merge").json()
    exp = fx["body"]["branch"]
    for k in ("id", "conversation_id", "fork_message_id", "anchor_start", "anchor_end", "anchor_quote", "status", "context_turns"):
        assert r["branch"][k] == exp[k], k
    assert r["merge_note"]["role"] == "merge_note" and r["merge_note"]["conversation_id"] == "cnv_transformer"
    assert r["merge_note"]["content"].startswith("分支「点积方差推导」要点：")  # 上一步改过名
