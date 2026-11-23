"""市场 registry 读取：`server/registry/plugins.json`、`skills.json`（由 scripts/build_registry.py 生成）。

目录可用环境变量 `MN_REGISTRY_DIR` 覆盖（测试用临时目录替换插件启动命令）。文件很小，每次请求重新读，
改完 registry 不用重启服务。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from app.config import SERVER_DIR

MARKET_FIELDS = ("id", "type", "name", "owner", "official", "stars", "stars_date", "license", "category", "desc_zh", "repo_url")


class RegistryUnavailable(RuntimeError):
    pass


def registry_dir() -> Path:
    return Path(os.environ.get("MN_REGISTRY_DIR", str(SERVER_DIR / "registry")))


def load(kind: str) -> list[dict]:
    """kind = 'plugin' | 'skill'。读不到或格式不对抛 RegistryUnavailable。"""
    path = registry_dir() / f"{kind}s.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise RegistryUnavailable(f"读取 {path.name} 失败：{e}") from e
    if not isinstance(data, list) or not all(isinstance(x, dict) and x.get("id") for x in data):
        raise RegistryUnavailable(f"{path.name} 格式不对")
    return data


def plugin_entry(plugin_id: str) -> dict | None:
    try:
        items = load("plugin")
    except RegistryUnavailable:
        return None
    return next((x for x in items if x["id"] == plugin_id), None)


def skill_entry_by_url(url: str) -> dict | None:
    try:
        items = load("skill")
    except RegistryUnavailable:
        return None
    norm = normalize_url(url)
    return next((x for x in items if normalize_url(x.get("repo_url", "")) == norm), None)


def normalize_url(url: str) -> str:
    return url.strip().rstrip("/").lower().removesuffix(".git")
