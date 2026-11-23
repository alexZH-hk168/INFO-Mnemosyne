"""Skill（B3b）：SKILL.md 头部校验、本机目录与 GitHub 目录导入（GitHub 用本地目录替代，不联网）、
启用开关、渐进加载（list_enabled / load）、附带脚本不执行。
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from tests.b3b_support import b3b_env  # noqa: F401


def make_skill(root: Path, name: str, desc: str = "检查论文的方法、证据和结论", extra_header: str = "", body: str = "# 用法\n先读 references/guide.md。\n") -> Path:
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {desc}\n{extra_header}---\n\n{body}", encoding="utf-8")
    (d / "references").mkdir()
    (d / "references" / "guide.md").write_text("指南\n", encoding="utf-8")
    (d / "scripts").mkdir()
    marker = root / f"{name}-ran"
    (d / "scripts" / "run.py").write_text(f"open({str(marker)!r}, 'w').write('ran')\n", encoding="utf-8")
    return d


def test_frontmatter_parse_variants():
    from app.skills.frontmatter import FrontMatterError, parse, split

    header, body = split('---\nname: "pdf"\ndescription: >\n  第一行\n  第二行\nlicense: \'Apache-2.0\'\nmetadata:\n  version: 1\nallowed-tools: Read, Grep  # 注释\n---\n\n正文\n')
    meta = parse(header)
    assert meta["name"] == "pdf" and meta["description"] == "第一行 第二行" and meta["license"] == "Apache-2.0"
    assert meta["metadata"] is None and meta["allowed-tools"] == "Read, Grep"
    assert body.strip() == "正文"
    meta = parse("name: x\ndescription: |\n  a\n  b\n")
    assert meta["description"] == "a\nb"
    with pytest.raises(FrontMatterError):
        split("# 没有头部\n")
    with pytest.raises(FrontMatterError):
        split("---\nname: x\n")


def test_import_local_list_toggle_and_load(b3b_env, client, db):
    from app.agent.hooks import get_skills

    src = make_skill(b3b_env / "src", "peer-review")
    r = client.post("/api/skills/import", json={"source": "local", "path": str(src)})
    assert r.status_code == 200, r.text
    sk = r.json()
    assert sk == {
        "id": "peer-review", "name": "peer-review", "description": "检查论文的方法、证据和结论",
        "dir_path": str(b3b_env / "skills" / "peer-review"), "enabled": True,
    }
    copied = b3b_env / "skills" / "peer-review"
    assert (copied / "SKILL.md").is_file() and (copied / "references" / "guide.md").is_file()
    detail = client.get("/api/skills/peer-review").json()
    assert detail["files"] == ["SKILL.md", "references/guide.md", "scripts/run.py"]
    assert detail["skill_md"].startswith("---\nname: peer-review")

    svc = get_skills()
    assert svc.list_enabled(db, project_id="prj_x") == [{"id": "peer-review", "name": "peer-review", "summary": "检查论文的方法、证据和结论"}]
    text = svc.load(db, skill_id="peer-review")
    assert text.startswith("# Skill：peer-review") and "先读 references/guide.md" in text
    assert "- references/guide.md" in text and "- scripts/run.py" in text and "不执行" in text
    assert "description:" not in text  # 头部不重复进正文
    assert not (b3b_env / "src" / "peer-review-ran").exists()  # 附带脚本没有被执行

    r = client.put("/api/skills/peer-review", json={"enabled": False})
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert svc.list_enabled(db, project_id="prj_x") == []
    assert svc.load(db, skill_id="peer-review") == ""
    # 重新导入保留启用状态，更新描述
    (src / "SKILL.md").write_text("---\nname: peer-review\ndescription: 新描述\nlicense: MIT\n---\n正文\n", encoding="utf-8")
    sk = client.post("/api/skills/import", json={"source": "local", "path": str(src)}).json()
    assert sk["enabled"] is False and sk["description"] == "新描述" and sk["license"] == "MIT"
    assert [s["id"] for s in client.get("/api/skills").json()["skills"]] == ["peer-review"]
    assert client.put("/api/skills/missing", json={"enabled": True}).status_code == 404


@pytest.mark.parametrize(
    "header,msg",
    [
        ("---\nname: my-notes\n---\n", "description"),
        ("---\ndescription: 只有描述\n---\n", "name"),
        ("---\nname: My Notes\ndescription: d\n---\n", "小写字母"),
        ("没有头部\n", "头部"),
    ],
)
def test_import_invalid_skill_md(b3b_env, client, header, msg):
    d = b3b_env / "bad"
    d.mkdir()
    (d / "SKILL.md").write_text(header, encoding="utf-8")
    r = client.post("/api/skills/import", json={"source": "local", "path": str(d)})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "SKILL_INVALID" and err["retriable"] is False and msg in err["message"]
    assert client.get("/api/skills").json()["skills"] == []
    assert not any((b3b_env / "skills").glob(".import-*")) if (b3b_env / "skills").exists() else True


def test_import_errors(b3b_env, client):
    d = b3b_env / "nomd"
    d.mkdir()
    r = client.post("/api/skills/import", json={"source": "local", "path": str(d)})
    assert r.status_code == 422 and "SKILL.md" in r.json()["error"]["message"]
    assert client.post("/api/skills/import", json={"source": "local", "path": str(b3b_env / "nope")}).status_code == 400
    assert client.post("/api/skills/import", json={"source": "local"}).status_code == 400
    assert client.post("/api/skills/import", json={"source": "github", "url": "https://gitlab.com/a/b"}).status_code == 400
    assert client.post("/api/skills/import", json={"source": "svn", "url": "x"}).status_code == 400


def test_import_github_with_local_stand_in(b3b_env, client, monkeypatch):
    import app.skills.service as svc

    src = make_skill(b3b_env / "gh", "literature-review", desc="检索筛选论文并整理综述证据")
    calls = []

    def fake_fetch(url, dest):
        calls.append(url)
        for p in src.rglob("*"):
            if p.is_file():
                t = dest / p.relative_to(src)
                t.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(p, t)

    monkeypatch.setattr(svc, "fetch_github", fake_fetch)
    url = "https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/literature-review"
    r = client.post("/api/skills/import", json={"source": "github", "url": url})
    assert r.status_code == 200, r.text
    sk = r.json()
    assert calls == [url] and sk["source_url"] == url
    assert sk["license"] == "MIT"  # SKILL.md 没写 license 时取市场条目（调研清单）的许可证
    market = {x["id"]: x for x in client.get("/api/market/skills").json()["items"]}
    assert market["literature-review"]["installed"] is True


def test_parse_github_url():
    from app.errors import ApiError
    from app.skills.service import parse_github_url

    assert parse_github_url("https://github.com/anthropics/skills/tree/main/skills/pdf") == ("anthropics", "skills", "main", "skills/pdf")
    assert parse_github_url("https://github.com/obra/superpowers") == ("obra", "superpowers", "", "")
    assert parse_github_url("https://github.com/a/b/blob/main/x/SKILL.md") == ("a", "b", "main", "x")
    for bad in ("https://example.com/a/b", "https://github.com/a", "https://github.com/a/b/issues/1"):
        with pytest.raises(ApiError):
            parse_github_url(bad)


def test_fetch_github_walks_contents_api(b3b_env, monkeypatch):
    """不联网：用 httpx.MockTransport 模拟 GitHub contents API，确认递归下载与目录相对路径。"""
    import httpx

    import app.skills.service as svc

    listing = {
        "skills/demo": [
            {"type": "file", "name": "SKILL.md", "path": "skills/demo/SKILL.md", "size": 40, "download_url": "https://raw.example/SKILL.md"},
            {"type": "dir", "name": "refs", "path": "skills/demo/refs"},
        ],
        "skills/demo/refs": [
            {"type": "file", "name": "a.md", "path": "skills/demo/refs/a.md", "size": 2, "download_url": "https://raw.example/a.md"},
        ],
    }

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "api.github.com":
            path = req.url.path.split("/contents/", 1)[1]
            assert req.url.params.get("ref") == "main"
            return httpx.Response(200, json=listing[path])
        body = b"---\nname: demo\ndescription: d\n---\n" if req.url.path.endswith("SKILL.md") else b"a\n"
        return httpx.Response(200, content=body)

    real_client = httpx.Client
    monkeypatch.setattr(svc.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    dest = b3b_env / "dl"
    dest.mkdir()
    svc.fetch_github("https://github.com/o/r/tree/main/skills/demo", dest)
    assert (dest / "SKILL.md").read_text().startswith("---\nname: demo")
    assert (dest / "refs" / "a.md").read_text() == "a\n"
