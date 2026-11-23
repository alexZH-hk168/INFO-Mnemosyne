"""从调研清单生成市场 registry：`server/registry/plugins.json`、`server/registry/skills.json`。

用法（契约 scripts.md）：
    python scripts/build_registry.py --in ../../03-调研/插件与Skill市场素材.json --out registry/

数据来源与规则：
- 条目、名称、owner、星数、星数日期、许可证、类别、简介、仓库地址**只来自调研 JSON**，不增删、不改值。
  `official` 由调研 JSON 的“官方/社区”转成布尔值。
- 条目 id 与插件简称 short_name 来自 `registry/sources/overlay.json`（Mnemosyne 侧数据，按 repo_url 对应）。
- 插件适配清单（mnemosyne-plugin.json）与详情字段来自 `registry/sources/manifests/<id>.json`；
  只有 `upstream.verified=true` 的插件 `verified=true`（v1 完整验收：arxiv、fetch）。
- 输出按调研 JSON 的顺序；任何条目缺 id、id 重复、清单 id 不在市场里，都直接报错退出（不生成半成品）。

每个插件条目：id, type, name, owner, official, stars, stars_date, license, category, desc_zh, repo_url,
verified, short_name?, manifest?, tools?, about_zh?, usage_zh?, permission_notes?（后四项为详情页用，见契约 v0.5 草案 [B3b]）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]


def _default_in() -> Path:
    """仓库外的 `INFO5000项目/03-调研/`：主仓库与 worktree 的层级不同，向上逐级找；可用 MN_RESEARCH_JSON 指定。"""
    if os.environ.get("MN_RESEARCH_JSON"):
        return Path(os.environ["MN_RESEARCH_JSON"])
    for parent in SERVER_DIR.parents:
        cand = parent / "03-调研" / "插件与Skill市场素材.json"
        if cand.exists():
            return cand
    return SERVER_DIR.parents[1] / "03-调研" / "插件与Skill市场素材.json"


DEFAULT_IN = _default_in()
DEFAULT_OUT = SERVER_DIR / "registry"
SOURCES = SERVER_DIR / "registry" / "sources"

MARKET_KEYS = ("name", "owner", "stars", "stars_date", "license", "category", "desc_zh", "repo_url")
MANIFEST_REQUIRED = ("id", "name", "version", "source_url", "license", "transport", "command", "args", "permissions")
PERMISSIONS = {"network", "fs_read", "fs_write", "exec"}
DETAIL_KEYS = ("tools", "about_zh", "usage_zh", "permission_notes")


class RegistryError(ValueError):
    pass


def _official(value) -> bool:
    if isinstance(value, bool):
        return value
    if value in ("官方", "official"):
        return True
    if value in ("社区", "community"):
        return False
    raise RegistryError(f"official 取值无法识别：{value!r}")


def check_manifest(m: dict) -> None:
    for k in MANIFEST_REQUIRED:
        if k not in m:
            raise RegistryError(f"适配清单 {m.get('id')} 缺少字段 {k}")
    if m["transport"] not in ("stdio", "http"):
        raise RegistryError(f"适配清单 {m['id']} transport 只能是 stdio 或 http")
    if not isinstance(m["args"], list) or not all(isinstance(a, str) for a in m["args"]):
        raise RegistryError(f"适配清单 {m['id']} args 必须是字符串数组")
    bad = set(m["permissions"]) - PERMISSIONS
    if bad:
        raise RegistryError(f"适配清单 {m['id']} 权限不合法：{sorted(bad)}")
    for key, spec in (m.get("env_schema") or {}).items():
        if set(spec) != {"required", "secret", "label"}:
            raise RegistryError(f"适配清单 {m['id']} env_schema.{key} 必须有 required/secret/label")


def load_sources(sources: Path = SOURCES) -> tuple[dict, dict[str, dict]]:
    overlay = json.loads((sources / "overlay.json").read_text(encoding="utf-8"))
    manifests: dict[str, dict] = {}
    for p in sorted((sources / "manifests").glob("*.json")):
        data = json.loads(p.read_text(encoding="utf-8"))
        m = data["manifest"]
        check_manifest(m)
        if m["id"] != p.stem:
            raise RegistryError(f"{p.name}：文件名与清单 id {m['id']} 不一致")
        manifests[m["id"]] = data
    return overlay, manifests


def build(research: dict, overlay: dict, manifests: dict[str, dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for kind in ("plugin", "skill"):
        ids = overlay["ids"][kind + "s"]
        items: list[dict] = []
        seen: set[str] = set()
        for row in research[kind + "s"]:
            for k in MARKET_KEYS:
                if k not in row:
                    raise RegistryError(f"调研条目 {row.get('name')} 缺少 {k}")
            iid = ids.get(row["repo_url"])
            if not iid:
                raise RegistryError(f"{kind} {row['name']}（{row['repo_url']}）在 overlay.json 里没有 id")
            if iid in seen:
                raise RegistryError(f"{kind} id 重复：{iid}")
            seen.add(iid)
            item = {"id": iid, "type": kind, "name": row["name"], "owner": row["owner"], "official": _official(row["official"])}
            for k in ("stars", "stars_date", "license", "category", "desc_zh", "repo_url"):
                item[k] = row[k]
            if kind == "plugin":
                src = manifests.get(iid)
                item["verified"] = bool(src and src.get("upstream", {}).get("verified"))
                short = overlay.get("short_names", {}).get(iid)
                if short:
                    item["short_name"] = short
                if src:
                    item["manifest"] = src["manifest"]
                    for k in DETAIL_KEYS:
                        if k in src.get("details", {}):
                            item[k] = src["details"][k]
            items.append(item)
        out[kind] = items
    stray = set(manifests) - {i["id"] for i in out["plugin"]}
    if stray:
        raise RegistryError(f"适配清单不在插件市场里：{sorted(stray)}")
    return out


def write(out_dir: Path, built: dict[str, list[dict]]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for kind in ("plugin", "skill"):
        path = out_dir / f"{kind}s.json"
        path.write_text(json.dumps(built[kind], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="src", default=str(DEFAULT_IN), help="调研 JSON")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="输出目录（registry/）")
    ap.add_argument("--sources", default=str(SOURCES), help="overlay.json 与 manifests/ 所在目录")
    args = ap.parse_args(argv)
    try:
        research = json.loads(Path(args.src).read_text(encoding="utf-8"))
        overlay, manifests = load_sources(Path(args.sources))
        built = build(research, overlay, manifests)
    except (OSError, ValueError, KeyError) as e:
        print(f"build_registry 失败：{e}", file=sys.stderr)
        return 1
    write(Path(args.out), built)
    print(json.dumps({k + "s": len(v) for k, v in built.items()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
