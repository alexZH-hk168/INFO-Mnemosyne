"""build_registry.py（B3b）：从调研清单生成的 registry 与 fixtures 的市场样例一致，且仓库里的 registry 是最新生成结果。"""

from __future__ import annotations

import json

import pytest

from tests.conftest import FIXTURES
from tests.b3b_support import REAL_REGISTRY

import scripts.build_registry as br


def _research():
    if not br.DEFAULT_IN.exists():
        pytest.skip(f"调研清单不在本机：{br.DEFAULT_IN}")
    return json.loads(br.DEFAULT_IN.read_text(encoding="utf-8"))


def test_registry_matches_research_and_fixtures():
    research = _research()
    overlay, manifests = br.load_sources()
    built = br.build(research, overlay, manifests)
    assert len(built["plugin"]) == 18 and len(built["skill"]) == 12
    for kind in ("plugin", "skill"):
        fx = json.loads((FIXTURES / f"get-market-{kind}s.ok.json").read_text(encoding="utf-8"))["body"]["items"]
        fx_by_id = {x["id"]: x for x in fx}
        assert [x["id"] for x in built[kind]] == [x["id"] for x in fx]
        for item in built[kind]:
            want = fx_by_id[item["id"]]
            for k in ("type", "name", "owner", "official", "stars", "stars_date", "license", "category", "desc_zh", "repo_url"):
                assert item[k] == want[k], (item["id"], k)
            if kind == "plugin":
                assert item["verified"] == want["verified"]
        # 星数、许可证等只来自调研清单
        src = {x["repo_url"]: x for x in research[kind + "s"]}
        for item in built[kind]:
            assert item["stars"] == src[item["repo_url"]]["stars"] and item["license"] == src[item["repo_url"]]["license"]
    verified = sorted(x["id"] for x in built["plugin"] if x["verified"])
    assert verified == ["arxiv", "fetch"]
    for pid in ("arxiv", "fetch"):
        m = next(x for x in built["plugin"] if x["id"] == pid)["manifest"]
        assert "@" in m["args"][0 if pid == "arxiv" else 0]  # 固定上游版本号
    # 仓库里提交的 registry 就是这次生成的结果
    for kind in ("plugin", "skill"):
        committed = json.loads((REAL_REGISTRY / f"{kind}s.json").read_text(encoding="utf-8"))
        assert committed == built[kind]


def test_build_rejects_bad_sources():
    research = _research()
    overlay, manifests = br.load_sources()
    broken = json.loads(json.dumps(overlay))
    broken["ids"]["plugins"].pop("https://github.com/blazickjp/arxiv-mcp-server")
    with pytest.raises(br.RegistryError):
        br.build(research, broken, manifests)
    bad = json.loads(json.dumps(manifests))
    bad["arxiv"]["manifest"]["permissions"] = ["root"]
    with pytest.raises(br.RegistryError):
        br.check_manifest(bad["arxiv"]["manifest"])


def test_cli_writes_files(tmp_path):
    _research()
    assert br.main(["--out", str(tmp_path)]) == 0
    assert len(json.loads((tmp_path / "plugins.json").read_text(encoding="utf-8"))) == 18
    assert len(json.loads((tmp_path / "skills.json").read_text(encoding="utf-8"))) == 12
