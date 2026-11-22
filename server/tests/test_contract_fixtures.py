"""契约比对：B1 负责的 15 个接口，逐份读取 docs/contract/fixtures/ 的样例，按样例里的 request 发请求，
比对状态码、错误码与 retriable、响应结构（契约模型 extra=forbid 校验 + 样例里出现的每个键在响应里同类型出现）。
样例本身也要通过同一组契约模型，保证模型与 fixtures 一致。
"""

from __future__ import annotations

import json
import sqlite3

import pytest
from pydantic import TypeAdapter

from app import models as m
from tests.conftest import FIXTURES, make_encrypted_pdf, make_pptx
from tests.seed import seed_world

RESPONSE_MODEL = {
    "GET /api/projects": m.ProjectList,
    "POST /api/projects": m.Project,
    "GET /api/projects/{pid}/conversations": m.ConversationList,
    "POST /api/projects/{pid}/conversations": m.Conversation,
    "GET /api/conversations/{cid}/tree": m.ConversationTree,
    "PUT /api/conversations/{cid}/active_leaf": m.ActiveLeaf,
    "GET /api/projects/{pid}/documents": m.DocumentGroups,
    "POST /api/projects/{pid}/documents": m.UploadResult,
    "GET /api/documents/{did}": m.Document,
    "GET /api/documents/{did}/raw": None,  # 原文件
    "POST /api/documents/{did}/reparse": m.JobResult,
    "GET /api/evidence/{eid}": m.Evidence,
    "GET /api/web_snapshots/{sid}": m.WebSnapshot,
}


def b1_fixtures() -> list[str]:
    names = []
    for p in sorted(FIXTURES.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if data.get("endpoint") in RESPONSE_MODEL and data.get("kind") in ("ok", "error"):
            names.append(p.stem)
    return names


FIXTURE_NAMES = b1_fixtures()


def test_fixture_inventory():
    """B1 的 13 个路由（项目、对话、材料、证据、快照）每个都有成功与错误样例。"""
    endpoints = {}
    for name in FIXTURE_NAMES:
        data = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
        endpoints.setdefault(data["endpoint"], set()).add(data["kind"])
    assert set(endpoints) == set(RESPONSE_MODEL)
    for ep, kinds in endpoints.items():
        assert kinds == {"ok", "error"}, ep


def json_type(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    return type(v).__name__


def assert_shape(expected, actual, path="body"):
    """样例中的每个键都要在响应里出现且类型相同；列表按 id（无 id 时按下标）配对比较。"""
    assert json_type(expected) == json_type(actual), f"{path}: 类型 {json_type(expected)} ≠ {json_type(actual)}"
    if isinstance(expected, dict):
        for k, v in expected.items():
            assert k in actual, f"{path}: 缺少字段 {k}"
            assert_shape(v, actual[k], f"{path}.{k}")
    elif isinstance(expected, list):
        if expected and not actual:
            raise AssertionError(f"{path}: 样例非空而响应为空列表")
        by_id = {x.get("id"): x for x in actual if isinstance(x, dict) and "id" in x}
        for i, e in enumerate(expected):
            if isinstance(e, dict) and "id" in e and e["id"] in by_id:
                assert_shape(e, by_id[e["id"]], f"{path}[{e['id']}]")
            elif i < len(actual):
                assert_shape(e, actual[i], f"{path}[{i}]")


@pytest.fixture
def world(client, db, env):
    from app.config import get_config

    seed_world(db, get_config().files_dir)
    return db


def build_request(fx: dict):
    method, tmpl = fx["endpoint"].split(" ", 1)
    req = fx.get("request") or {}
    url = tmpl
    for k, v in (req.get("params") or {}).items():
        url = url.replace("{" + k + "}", v)
    kwargs = {}
    if req.get("query"):
        kwargs["params"] = req["query"]
    if "body" in req:
        kwargs["json"] = req["body"]
    if req.get("files"):
        files = []
        for name in req["files"]:
            data = make_pptx([["位置编码", "sin/cos"]]) if name.endswith(".pptx") else b"PK\x03\x04 fake docx"
            files.append(("file", (name, data, "application/octet-stream")))
        kwargs["files"] = files
    return method, url, kwargs


def prepare(name: str, world: sqlite3.Connection, monkeypatch):
    """个别错误样例需要先把世界改成样例描述的状态。"""
    if name == "get-projects.error":
        import app.api.projects as projects

        def boom(*_a, **_k):
            raise sqlite3.OperationalError("disk I/O error")

        monkeypatch.setattr(projects, "project_out", boom)
    if name == "post-documents-did-reparse.error":
        path = world.execute("SELECT path FROM documents WHERE id = 'doc_longmemeval'").fetchone()[0]
        with open(path, "wb") as f:
            f.write(make_encrypted_pdf())


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_fixture_contract(name, client, world, monkeypatch):
    fx = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    prepare(name, world, monkeypatch)
    method, url, kwargs = build_request(fx)
    resp = client.request(method, url, **kwargs)
    assert resp.status_code == fx["status"], resp.text

    if fx["kind"] == "error":
        body = resp.json()
        m.ApiErrorBody.model_validate(fx["body"])
        m.ApiErrorBody.model_validate(body)
        assert body["error"]["code"] == fx["body"]["error"]["code"]
        assert body["error"]["retriable"] == fx["body"]["error"]["retriable"]
        assert body["error"]["message"]
        return

    model = RESPONSE_MODEL[fx["endpoint"]]
    if model is None:  # raw
        ctype = fx.get("content_type", "application/json")
        assert resp.headers["content-type"].startswith(ctype)
        assert resp.text == fx["body"]
        return
    TypeAdapter(model).validate_python(fx["body"])  # 样例符合契约模型
    body = resp.json()
    model.model_validate(body)  # 响应符合契约模型（不多发字段）
    assert_shape(fx["body"], body)


def test_tree_equals_fixture(client, world):
    """种子数据来自 fixture，树接口应原样还原（含 steps、citations、context_turns）。"""
    fx = json.loads((FIXTURES / "get-conversations-cid-tree.ok.json").read_text(encoding="utf-8"))
    body = client.get("/api/conversations/cnv_transformer/tree").json()
    # seed 另加的消息（不在该 fixture 里）：重新生成的兄弟回答、F4 代码问答回合
    extra = {"msg_tf_a1b", "msg_code_u1", "msg_code_a1"}
    body["messages"] = [x for x in body["messages"] if x["id"] not in extra]
    expected = dict(fx["body"])
    # 契约没有规定 messages 的顺序（样例是主线在前、分支在后，接口按 created_at），按 id 比较
    by_id = lambda xs: sorted(xs, key=lambda x: x["id"])  # noqa: E731
    assert by_id(body.pop("messages")) == by_id(expected.pop("messages"))
    assert body == expected


@pytest.mark.parametrize(
    "variant",
    ["get-evidence-eid.ok", "get-evidence-eid.pptx.ok", "get-evidence-eid.message.ok", "get-evidence-eid.web.ok", "get-evidence-eid.code.ok"],
)
def test_evidence_equals_fixture(variant, client, world):
    fx = json.loads((FIXTURES / f"{variant}.json").read_text(encoding="utf-8"))
    body = client.get(f"/api/evidence/{fx['request']['params']['eid']}").json()
    expected = dict(fx["body"])
    if variant.endswith("web.ok"):
        # 证据标题取快照标题（The Illustrated Transformer – Jay Alammar），样例写的是简称
        assert body["title"].startswith(expected["title"])
        body.pop("title")
        expected.pop("title")
    assert body == expected
