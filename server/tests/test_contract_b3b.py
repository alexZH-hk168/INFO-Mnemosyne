"""契约比对：B3b 负责的接口（市场、插件、会话插件、Skill）逐份读取 docs/contract/fixtures/ 的样例，按样例里的
request 发请求，比对状态码、错误码与 retriable、响应结构（契约模型 extra=forbid + 样例里的每个键在响应里同类型出现）。
样例本身也要通过同一组模型。插件安装用本地假 MCP 服务代替 uvx（不联网、不下载依赖）。
"""

from __future__ import annotations

import json
import sqlite3

import pytest
from pydantic import TypeAdapter

from app import models as m
from app.plugins import schemas as s
from tests.b3b_support import b3b_env, fake_manifest, seed_plugins_and_skills, write_registry  # noqa: F401
from tests.conftest import FIXTURES
from tests.seed import seed_world
from tests.test_contract_fixtures import assert_shape, build_request

RESPONSE_MODEL = {
    "GET /api/market/plugins": s.MarketList,
    "GET /api/market/skills": s.MarketList,
    "GET /api/plugins": s.InstalledPluginList,
    "GET /api/plugins/{id}": s.PluginDetail,
    "POST /api/plugins/{id}": s.InstalledPlugin,
    "DELETE /api/plugins/{id}": s.OkResult,
    "GET /api/conversations/{cid}/plugins": s.ConversationPluginList,
    "PUT /api/conversations/{cid}/plugins": s.ConversationPluginList,
    "GET /api/skills": s.SkillList,
    "GET /api/skills/{id}": s.SkillDetail,
    "POST /api/skills/import": s.Skill,
    "PUT /api/skills/{id}": s.Skill,
}


def b3b_fixtures() -> list[str]:
    names = []
    for p in sorted(FIXTURES.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if data.get("endpoint") in RESPONSE_MODEL and data.get("kind") in ("ok", "error"):
            names.append(p.stem)
    return names


FIXTURE_NAMES = b3b_fixtures()


def test_fixture_inventory():
    """12 个路由每个都有成功与错误样例（共 26 份，含未安装插件详情变体、F6b 的未适配插件安装错误）。"""
    endpoints: dict[str, set] = {}
    for name in FIXTURE_NAMES:
        data = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
        endpoints.setdefault(data["endpoint"], set()).add(data["kind"])
    assert set(endpoints) == set(RESPONSE_MODEL)
    for ep, kinds in endpoints.items():
        assert kinds == {"ok", "error"}, ep
    assert len(FIXTURE_NAMES) == 26


@pytest.fixture
def world(b3b_env, client, db, monkeypatch):
    from app.config import get_config

    # fetch 换成本地假服务（v1 验收的真实 uvx 安装由编排做）；markitdown 用握手前睡 30 s 的假服务模拟自检超时
    # （F6b 把 post-plugins-id.error 的插件由 docling 改成 markitdown；docling 没有适配清单，走 not-adapted 的 400）
    reg = write_registry(
        b3b_env / "registry",
        overrides={
            "fetch": fake_manifest("fetch", name="Fetch MCP Server", tools_allow=["fetch"], mapping={"title": "$args.url", "url": "$args.url", "quote": "$text"}),
            "markitdown": fake_manifest("markitdown", name="MarkItDown MCP", extra_args=["--delay", "30"], permissions=("network", "fs_read")),
        },
    )
    monkeypatch.setenv("MN_REGISTRY_DIR", str(reg))
    seed_world(db, get_config().files_dir)
    seed_plugins_and_skills(db, b3b_env / "skills")
    return db


def prepare(name: str, world: sqlite3.Connection, tmp, monkeypatch):
    if name == "get-plugins.error":
        from app.plugins.runtime import plugins

        def boom(*_a, **_k):
            raise sqlite3.OperationalError("disk I/O error")

        monkeypatch.setattr(plugins, "list_installed", boom)
    if name == "get-skills.error":
        from app.skills.service import skills

        def boom(*_a, **_k):
            raise sqlite3.OperationalError("disk I/O error")

        monkeypatch.setattr(skills, "list", boom)
    if name in ("get-market-plugins.error", "get-market-skills.error"):
        monkeypatch.setenv("MN_REGISTRY_DIR", str(tmp / "no-registry"))
    if name == "post-plugins-id.error":
        monkeypatch.setenv("MN_PLUGIN_START_TIMEOUT_S", "1.5")
    if name == "post-skills-import.ok":
        import shutil

        import app.skills.service as svc

        src = tmp / "gh-peer-review"
        src.mkdir()
        (src / "SKILL.md").write_text("---\nname: peer-review\ndescription: 检查论文的方法、证据和结论\n---\n\n# Peer review\n", encoding="utf-8")
        (src / "references").mkdir()
        (src / "references" / "checklist.md").write_text("- 方法\n", encoding="utf-8")

        def fake_fetch(url, dest):
            for p in src.rglob("*"):
                if p.is_file():
                    t = dest / p.relative_to(src)
                    t.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(p, t)

        monkeypatch.setattr(svc, "fetch_github", fake_fetch)
    if name == "post-skills-import.error":
        d = tmp / "home" / "skills" / "my-notes"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text("---\nname: my-notes\n---\n\n没有 description\n", encoding="utf-8")


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_fixture_contract(name, client, world, b3b_env, monkeypatch):
    fx = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    prepare(name, world, b3b_env, monkeypatch)
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
        if "details" in fx["body"]["error"]:
            assert_shape(fx["body"]["error"]["details"], body["error"].get("details"), "error.details")
        return
    model = RESPONSE_MODEL[fx["endpoint"]]
    TypeAdapter(model).validate_python(fx["body"])
    body = resp.json()
    model.model_validate(body)
    assert_shape(fx["body"], body)


def _drop(items: list[dict], *keys: str) -> list[dict]:
    return [{k: v for k, v in x.items() if k not in keys} for x in items]


@pytest.mark.parametrize("kind", ["plugins", "skills"])
def test_market_equals_fixture(kind, client, world):
    """市场条目逐字段等于 fixture（fixture 由调研清单机械转换；F6b 起插件 fixture 也带 short_name）。"""
    fx = json.loads((FIXTURES / f"get-market-{kind}.ok.json").read_text(encoding="utf-8"))
    body = client.get(f"/api/market/{kind}").json()
    assert body["items"] == fx["body"]["items"]


def test_installed_and_conversation_plugins_match_fixture(client, world):
    fx = json.loads((FIXTURES / "get-plugins.ok.json").read_text(encoding="utf-8"))["body"]["plugins"]
    body = client.get("/api/plugins").json()["plugins"]
    assert body == fx  # U96 已同步：markitdown 权限 network + fs_read
    assert {p["id"]: p["permissions"] for p in body} == {"arxiv": ["network", "fs_write"], "fetch": ["network"], "markitdown": ["network", "fs_read"]}
    fx = json.loads((FIXTURES / "get-conversations-cid-plugins.ok.json").read_text(encoding="utf-8"))["body"]["plugins"]
    body = client.get("/api/conversations/cnv_transformer/plugins").json()["plugins"]
    assert _drop(body, "short_name") == fx
    assert {p["plugin_id"]: p["short_name"] for p in body} == {"arxiv": "arXiv", "fetch": "网页检索", "markitdown": "PDF 解析"}


def test_arxiv_detail_matches_fixture(client, world):
    fx = json.loads((FIXTURES / "get-plugins-id.ok.json").read_text(encoding="utf-8"))["body"]
    body = client.get("/api/plugins/arxiv").json()
    for k in ("id", "name", "version", "status", "permissions", "config_schema", "last_check_at", "config_set", "config",
              "verified", "tools", "about_zh", "usage_zh", "permission_notes"):
        assert body[k] == fx[k], k
    assert body["manifest"]["tools_allow"] == fx["manifest"]["tools_allow"]
    assert body["manifest"]["args"] == fx["manifest"]["args"] == ["arxiv-mcp-server@0.8.2", "--storage-path", "~/.mnemosyne/plugins/arxiv"]


def test_tavily_not_installed_detail_matches_fixture(client, world):
    fx = json.loads((FIXTURES / "get-plugins-id.not-installed.ok.json").read_text(encoding="utf-8"))["body"]
    body = client.get("/api/plugins/tavily").json()
    for k, v in fx.items():
        assert body[k] == v, k


def test_skill_detail_matches_fixture(client, world):
    fx = json.loads((FIXTURES / "get-skills-id.ok.json").read_text(encoding="utf-8"))["body"]
    body = client.get("/api/skills/pdf").json()
    assert {k: v for k, v in body.items() if k != "dir_path"} == {k: v for k, v in fx.items() if k != "dir_path"}
    assert body["dir_path"].endswith("/skills/pdf")


def test_plugin_turn_steps_and_evidence_match_fixture(client, world):
    """F6b 的插件回合（sse-turn-plugin.json）：树接口里插件步骤带 plugin_id，插件证据的标题与 SSE 样例一致。"""
    from tests.test_contract_fixtures import make_plugin_turn_active

    fx = json.loads((FIXTURES / "sse-turn-plugin.json").read_text(encoding="utf-8"))
    done = [e["data"] for e in fx["events"] if e["event"] == "step" and e["data"]["status"] == "done"]
    tree = client.get("/api/conversations/cnv_transformer/tree").json()
    steps = [m for m in tree["messages"] if m["id"] == "msg_plugin_a1"][0]["steps"]
    assert steps == [{k: d[k] for k in ("step_id", "kind", "label", "status", "duration_ms", "plugin_id")} for d in done]
    ev = next(e["data"] for e in fx["events"] if e["event"] == "evidence" and e["data"]["source_type"] == "plugin")
    make_plugin_turn_active(world)
    body = client.get(f"/api/evidence/{ev['eid']}").json()
    assert body["title"] == ev["title"] and body["locator"] == ev["locator"]


def test_arxiv_get_abstract_becomes_plugin_evidence(b3b_env, db):
    """真实 arxiv-mcp-server 0.8.2 的 get_abstract 返回结构（源码 tools/get_abstract.py）→ 无 URL 插件证据，
    标题、fields 形状与 F6b 的 get-evidence-eid.plugin.ok 一致；search_papers 的记录带 url → 网页快照。"""
    from app.plugins import mapping, registry

    manifest = registry.plugin_entry("arxiv")["manifest"]
    fx = json.loads((FIXTURES / "get-evidence-eid.plugin.ok.json").read_text(encoding="utf-8"))["body"]
    f = fx["locator"]["fields"]
    raw = {"status": "success", **f, "pdf_url": "https://arxiv.org/pdf/1706.03762"}
    drafts = mapping.to_evidence(db, plugin_id="arxiv", plugin_name="ArXiv MCP Server", tool_name="get_abstract",
                                 mapping=manifest["evidence_mapping"], arguments={"paper_id": "1706.03762"},
                                 text=json.dumps(raw), structured=None)
    assert len(drafts) == 1
    d = drafts[0]
    assert d.kind == "plugin" and d.source_id == "arxiv" and d.title == fx["title"]
    assert d.locator["tool_name"] == "get_abstract" and d.locator["fields"]["authors"] == f["authors"]
    assert {k: d.locator["fields"][k] for k in f} == f
    assert fx["quote"] in d.quote  # 样例只截了摘要中的一句；运行时给整段摘要，引用句由回答校验
    assert mapping.title_from_locator(manifest, d.locator) == fx["title"]
    search = {"total_results": 1, "papers": [{"id": "1706.03762", "title": "Attention Is All You Need", "abstract": f["abstract"],
                                              "url": "https://arxiv.org/pdf/1706.03762"}]}
    drafts = mapping.to_evidence(db, plugin_id="arxiv", plugin_name="ArXiv MCP Server", tool_name="search_papers",
                                 mapping=manifest["evidence_mapping"], arguments={"query": "attention"},
                                 text=json.dumps(search), structured=None)
    assert [x.kind for x in drafts] == ["web"] and drafts[0].title == fx["title"]
