"""B3b 测试共用：临时 registry（把插件启动命令换成本地假 MCP 服务）、临时 Skill 目录、插件与 Skill 种子数据。

不改 B1 的 conftest.py；各测试文件从这里引入夹具。
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

from tests.conftest import load_fixture

SERVER = Path(__file__).resolve().parents[1]
REAL_REGISTRY = SERVER / "registry"
FAKE_SERVER = str(Path(__file__).resolve().with_name("fake_mcp_server.py"))


def fake_manifest(pid: str, *, name=None, tools_allow=None, extra_args=(), env_schema=None, mapping=None, permissions=("network",)) -> dict:
    m = {
        "id": pid, "name": name or f"Fake {pid}", "version": "1.0.0", "source_url": "https://example.invalid/fake", "license": "MIT",
        "transport": "stdio", "command": sys.executable, "args": [FAKE_SERVER, *extra_args],
        "env_schema": env_schema or {}, "permissions": list(permissions),
        "evidence_mapping": mapping if mapping is not None else {"items": "$.papers", "title": "$.title", "url": ["$.url", "$.pdf_url"], "quote": ["$.abstract", "$.body"]},
    }
    if tools_allow is not None:
        m["tools_allow"] = list(tools_allow)
    return m


def write_registry(dst: Path, *, overrides: dict[str, dict] | None = None, extra: list[dict] | None = None) -> Path:
    """复制真实 registry，按 overrides 替换插件的 manifest，并追加 extra 条目（测试专用插件）。"""
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REAL_REGISTRY / "skills.json", dst / "skills.json")
    items = json.loads((REAL_REGISTRY / "plugins.json").read_text(encoding="utf-8"))
    for item in items:
        if overrides and item["id"] in overrides:
            item["manifest"] = overrides[item["id"]]
    items.extend(extra or [])
    (dst / "plugins.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    return dst


def market_entry(manifest: dict, **kw) -> dict:
    entry = {
        "id": manifest["id"], "type": "plugin", "name": manifest["name"], "owner": "test", "official": False, "stars": 0,
        "stars_date": "2026-11-21", "license": "MIT", "category": "学术检索", "desc_zh": "测试插件",
        "repo_url": f"https://example.invalid/{manifest['id']}", "verified": False, "manifest": manifest,
    }
    entry.update(kw)
    return entry


@pytest.fixture
def b3b_env(env, tmp_path, monkeypatch):
    """Skill 目录与 HOME 指向临时目录；测试结束关闭全部插件会话（结束假服务进程）。"""
    monkeypatch.setenv("MN_SKILLS_DIR", str(tmp_path / "skills"))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir(exist_ok=True)
    monkeypatch.setenv("MN_PLUGIN_START_TIMEOUT_S", "20")
    yield tmp_path
    from app.plugins.host import host

    host.shutdown()


def seed_plugins_and_skills(conn, skills_dir: Path) -> None:
    """按 fixtures 写入已安装插件（arxiv、fetch、markitdown）与 Skill（pdf、literature-review）。"""
    from app.plugins import registry, store

    for p in load_fixture("get-plugins.ok")["body"]["plugins"]:
        entry = registry.plugin_entry(p["id"])
        manifest = entry["manifest"]
        store.save_installed(conn, manifest, {}, p["status"], None, p["last_check_at"])
    detail = load_fixture("get-skills-id.ok")["body"]
    for sk in load_fixture("get-skills.ok")["body"]["skills"]:
        d = skills_dir / sk["id"]
        d.mkdir(parents=True, exist_ok=True)
        if sk["id"] == detail["id"]:
            (d / "SKILL.md").write_text(detail["skill_md"], encoding="utf-8")
            for f in detail["files"]:
                if f != "SKILL.md":
                    (d / f).write_text("license text\n", encoding="utf-8")
        else:
            (d / "SKILL.md").write_text(f"---\nname: {sk['name']}\ndescription: {sk['description']}\n---\n\n正文\n", encoding="utf-8")
        conn.execute(
            "INSERT INTO skills (id, name, description, dir_path, source_url, license, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (sk["id"], sk["name"], sk["description"], str(d), sk.get("source_url"), sk.get("license"), 1 if sk["enabled"] else 0),
        )
    conn.commit()
