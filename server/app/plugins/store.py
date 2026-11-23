"""plugins / conversation_plugins 表读写、配置合并与启动参数。"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from app.config import get_config
from app.plugins import secrets
from app.plugins.host import LaunchSpec

# 子进程默认只继承 HOME/PATH 等少数变量（mcp SDK 的安全默认）；联网插件与 uvx/npx 还需要代理与镜像配置。
PASSTHROUGH_ENV = (
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
    "UV_CACHE_DIR", "UV_TOOL_DIR", "UV_PYTHON_INSTALL_DIR", "UV_INDEX_URL", "UV_DEFAULT_INDEX", "UV_PYTHON",
    "PIP_INDEX_URL", "NPM_CONFIG_REGISTRY", "npm_config_registry", "npm_config_cache", "XDG_CACHE_HOME",
    "SSL_CERT_FILE", "LANG", "LC_ALL",
)
TOOLS_KEY = "x_mnemosyne_tools"  # manifest_json 里额外保存的“上次自检 tools/list 结果”


def get_row(conn: sqlite3.Connection, plugin_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM plugins WHERE id = ?", (plugin_id,)).fetchone()


def installed_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM plugins ORDER BY rowid").fetchall()


def manifest_of(row: sqlite3.Row) -> dict:
    data = json.loads(row["manifest_json"] or "{}")
    data.pop(TOOLS_KEY, None)
    return data


def listed_tools(row: sqlite3.Row) -> list[dict]:
    return list(json.loads(row["manifest_json"] or "{}").get(TOOLS_KEY) or [])


def stored_config(row: sqlite3.Row | None) -> dict[str, str]:
    if row is None or not row["config_json"]:
        return {}
    raw = json.loads(row["config_json"])
    return {k: secrets.decrypt(v) if isinstance(v, str) else str(v) for k, v in raw.items()}


def merge_config(manifest: dict, old: dict[str, str], patch: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    """未提供的键沿用已存值，空字符串清除（契约 v0.3）。返回（新配置，错误列表）。"""
    schema = manifest.get("env_schema") or {}
    errors = [f"未知配置项 {k}" for k in patch if k not in schema]
    cfg = {k: v for k, v in old.items() if k in schema}
    for k, v in patch.items():
        if k not in schema:
            continue
        if v == "":
            cfg.pop(k, None)
        else:
            cfg[k] = str(v)
    return cfg, errors


def missing_required(manifest: dict, cfg: dict[str, str]) -> list[str]:
    schema = manifest.get("env_schema") or {}
    return [spec.get("label") or k for k, spec in schema.items() if spec.get("required") and not cfg.get(k)]


def encode_config(manifest: dict, cfg: dict[str, str]) -> str:
    schema = manifest.get("env_schema") or {}
    return json.dumps(
        {k: secrets.encrypt(v) if schema.get(k, {}).get("secret") else v for k, v in cfg.items()}, ensure_ascii=False
    )


def log_path(plugin_id: str) -> str:
    return str(get_config().data_dir / "plugins" / "logs" / f"{plugin_id}.log")


def launch_spec(manifest: dict, cfg: dict[str, str]) -> LaunchSpec:
    env = {k: os.environ[k] for k in PASSTHROUGH_ENV if os.environ.get(k)}
    env.update(cfg)
    args = tuple(os.path.expanduser(a) if a.startswith("~") else a for a in manifest.get("args") or [])
    command = manifest.get("command") or ""
    if command.startswith("~"):
        command = os.path.expanduser(command)
    return LaunchSpec(
        plugin_id=manifest["id"],
        transport=manifest.get("transport", "stdio"),
        command=command,
        args=args,
        env=tuple(sorted(env.items())),
        url=manifest.get("url") or (command if manifest.get("transport") == "http" else None),
        log_path=log_path(manifest["id"]),
    )


def save_installed(
    conn: sqlite3.Connection, manifest: dict, cfg: dict[str, str], status: str, tools: list[dict] | None, checked_at: str
) -> None:
    data = dict(manifest)
    if tools is not None:
        data[TOOLS_KEY] = tools
    else:
        old = get_row(conn, manifest["id"])
        if old is not None and listed_tools(old):
            data[TOOLS_KEY] = listed_tools(old)
    conn.execute(
        """INSERT INTO plugins (id, name, version, manifest_json, config_json, status, last_check_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version,
             manifest_json = excluded.manifest_json, config_json = excluded.config_json,
             status = excluded.status, last_check_at = excluded.last_check_at""",
        (manifest["id"], manifest["name"], manifest.get("version"), json.dumps(data, ensure_ascii=False),
         encode_config(manifest, cfg), status, checked_at),
    )
    conn.commit()


def installed_out(row: sqlite3.Row, short_name: str | None = None) -> dict:
    manifest = manifest_of(row)
    schema = manifest.get("env_schema") or {}
    cfg = stored_config(row)
    out = {
        "id": row["id"],
        "name": row["name"],
        "version": row["version"] or manifest.get("version") or "",
        "status": row["status"],
        "permissions": list(manifest.get("permissions") or []),
        "config_schema": schema,
        "last_check_at": row["last_check_at"],
        "config_set": sorted(cfg),
        "config": {k: v for k, v in cfg.items() if not schema.get(k, {}).get("secret")},
    }
    if short_name:
        out["short_name"] = short_name
    return out


def conversation_flags(conn: sqlite3.Connection, conversation_id: str) -> dict[str, bool]:
    return {
        r["plugin_id"]: bool(r["enabled"])
        for r in conn.execute("SELECT plugin_id, enabled FROM conversation_plugins WHERE conversation_id = ?", (conversation_id,))
    }


def plugins_dir() -> Path:
    return get_config().data_dir / "plugins"
