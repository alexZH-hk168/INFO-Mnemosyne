"""[VER1] 真实插件集成测试：真的用 uvx 拉起 arxiv-mcp-server@0.8.2 与 mcp-server-fetch，经 HTTP 接口安装、自检、
在回合里各调一次真实工具，证据进库并能读回。会访问 PyPI、arXiv 与 arxiv.org 网页，所以默认跳过：

    MN_REAL_PLUGINS=1 .venv/bin/python -m pytest -q tests/test_real_plugins.py

模型仍是确定性假模型（演示模式，不产生费用）：消息里写 `插件id__工具名 {JSON 参数}`，假模型按原样调用该工具。
首次运行（uv 缓存为空）安装要下载约 100 MB 依赖，安装自检上限见 `runtime.install_timeout()`（默认 180 s）。
"""

from __future__ import annotations

import os

import pytest

from .test_messages import send

pytestmark = pytest.mark.skipif(os.environ.get("MN_REAL_PLUGINS") != "1", reason="真实插件测试默认跳过，设 MN_REAL_PLUGINS=1 才跑（要联网）")

ARXIV_ID = "1706.03762"


@pytest.fixture
def real(client, monkeypatch):
    monkeypatch.delenv("MN_REGISTRY_DIR", raising=False)  # 用仓库里的真实 registry
    pid = client.post("/api/projects", json={"name": "VER1 真实插件"}).json()["id"]
    cid = client.post(f"/api/projects/{pid}/conversations", json={}).json()["id"]
    return client, cid


def _install(client, plugin_id):
    r = client.post(f"/api/plugins/{plugin_id}", json={"config": {}})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "installed"
    detail = client.get(f"/api/plugins/{plugin_id}").json()
    names = {t["name"] for t in detail["tools"]}
    allow = set(detail["manifest"].get("tools_allow") or [])
    assert allow <= names, f"tools_allow 里有真实 tools/list 没有的工具：{sorted(allow - names)}"
    return names


def _turn(client, cid, content, plugin_id):
    r, ev, _ = send(client, cid, content, scope={"mode": "none"})
    assert r.status_code == 200, r.text
    assert ev[-1][0] == "message.end", ev[-1]
    steps = [d for e, d in ev if e == "step" and d["status"] != "running" and d["kind"] == "plugin_tool"]
    assert steps and steps[0]["status"] == "done" and steps[0]["plugin_id"] == plugin_id, steps
    return [d for e, d in ev if e == "evidence" and d["source_type"] in ("web", "plugin")]


def test_real_arxiv_and_fetch(real, db):
    client, cid = real
    arxiv_tools = _install(client, "arxiv")
    assert {"search_papers", "get_abstract"} <= arxiv_tools
    assert _install(client, "fetch") == {"fetch"}
    convp = {p["plugin_id"]: p for p in client.get(f"/api/conversations/{cid}/plugins").json()["plugins"]}
    assert convp["arxiv"]["enabled"] and convp["fetch"]["enabled"]

    # 1) arXiv search_papers：记录带 url（PDF 链接）→ web 证据 + 网页快照
    ev = _turn(client, cid, 'arxiv__search_papers {"query": "attention is all you need", "max_results": 3}', "arxiv")
    assert ev and all(d["source_type"] == "web" and d["title"].startswith("arXiv:") for d in ev)
    assert any(ARXIV_ID in d["title"] for d in ev), [d["title"] for d in ev]
    got = client.get(f"/api/evidence/{ev[0]['eid']}").json()
    snap = client.get(f"/api/web_snapshots/{got['locator']['snapshot_id']}")
    assert snap.status_code == 200 and snap.json()["url"].startswith("https://arxiv.org/")

    # 2) arXiv get_abstract：没有 url → 无 URL 插件证据（右栏插件结果卡片）
    ev = _turn(client, cid, f'arxiv__get_abstract {{"paper_id": "{ARXIV_ID}"}}', "arxiv")
    plug = [d for d in ev if d["source_type"] == "plugin"]
    assert len(plug) == 1 and plug[0]["title"] == f"arXiv:{ARXIV_ID} · Attention Is All You Need"
    got = client.get(f"/api/evidence/{plug[0]['eid']}").json()
    assert got["source_type"] == "plugin" and got["locator"]["tool_name"] == "get_abstract"
    assert "Transformer" in got["locator"]["fields"]["abstract"]

    # 3) Fetch：抓 arXiv 摘要页 → web 证据，快照正文是插件返回的 Markdown
    ev = _turn(client, cid, f'fetch__fetch {{"url": "https://arxiv.org/abs/{ARXIV_ID}", "max_length": 3000}}', "fetch")
    assert len(ev) == 1 and ev[0]["source_type"] == "web" and ev[0]["title"] == f"https://arxiv.org/abs/{ARXIV_ID}"
    got = client.get(f"/api/evidence/{ev[0]['eid']}").json()
    snap = client.get(f"/api/web_snapshots/{got['locator']['snapshot_id']}").json()
    assert "Attention Is All You Need" in snap["text"]

    n = db.execute("SELECT COUNT(*) FROM evidence WHERE source_type IN ('web', 'plugin')").fetchone()[0]
    assert n >= 3
