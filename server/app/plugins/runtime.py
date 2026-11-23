"""插件运行时：模块级对象 `plugins` 实现 `app.agent.hooks.PluginService`（list_tools、call_tool），
另提供 `/api/plugins*`、`/api/conversations/{cid}/plugins`、`/api/market/*` 用的方法。

- 对话启用规则（编排决定）：对话里保存过设置的插件按已存值；没保存过的已安装插件默认启用。
  status 不是 installed、或缺必填配置的插件不向模型暴露工具。
- 工具名 `插件id__工具名`；只暴露清单 `tools_allow` 里的工具（省略＝全部）。
- 单次调用超时默认 30 s（调用方可传 timeout_s），超时返回 is_error 的 ToolResult，文本以 `PLUGIN_TIMEOUT` 开头。
- 安装 / 改配置 / 重新检查共用 `install()`：启动 + tools/list 自检，失败抛 PLUGIN_SELF_CHECK_FAILED（details.log_tail）。
"""

from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
from typing import Any

from app.agent.hooks import ToolResult, ToolSpec
from app.errors import ApiError, not_found
from app.ids import now_iso
from app.plugins import mapping, registry, store
from app.plugins.host import (
    DEFAULT_START_TIMEOUT_S,
    PluginCallError,
    PluginCallTimeout,
    PluginStartError,
    ToolInfo,
    host,
)

log = logging.getLogger("mnemosyne.plugins")

MAX_TEXT = 12000


def start_timeout() -> float:
    try:
        return float(os.environ.get("MN_PLUGIN_START_TIMEOUT_S", DEFAULT_START_TIMEOUT_S))
    except ValueError:
        return DEFAULT_START_TIMEOUT_S


def _truncate(text: str, limit: int = MAX_TEXT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…（插件返回共 {len(text)} 字，已截断到前 {limit} 字）"


def _short_names() -> dict[str, str]:
    try:
        return {x["id"]: x["short_name"] for x in registry.load("plugin") if x.get("short_name")}
    except registry.RegistryUnavailable:
        return {}


def _conversation_or_404(conn: sqlite3.Connection, cid: str) -> sqlite3.Row:
    row = conn.execute("SELECT id, project_id FROM conversations WHERE id = ?", (cid,)).fetchone()
    if row is None:
        raise not_found("对话")
    return row


def _unavailable_reason(row: sqlite3.Row) -> str | None:
    if row["status"] == "error":
        return "上次自检失败，可在插件详情里重新检查"
    if row["status"] == "disabled":
        return "插件已停用"
    missing = store.missing_required(store.manifest_of(row), store.stored_config(row))
    if missing:
        return "缺少配置：" + "、".join(missing)
    return None


class PluginRuntime:
    # ---------- hooks.PluginService ----------
    def enabled_rows(self, conn: sqlite3.Connection, conversation_id: str | None) -> list[sqlite3.Row]:
        flags = store.conversation_flags(conn, conversation_id) if conversation_id else {}
        return [
            r for r in store.installed_rows(conn)
            if flags.get(r["id"], True) and _unavailable_reason(r) is None
        ]

    async def list_tools(self, conn: sqlite3.Connection, *, conversation_id: str) -> list[ToolSpec]:
        rows = self.enabled_rows(conn, conversation_id)
        specs = [store.launch_spec(store.manifest_of(r), store.stored_config(r)) for r in rows]
        results = await asyncio.gather(*(host.tools(s, start_timeout()) for s in specs), return_exceptions=True)
        out: list[ToolSpec] = []
        for row, res in zip(rows, results):
            if isinstance(res, BaseException):
                log.warning("插件 %s 取工具列表失败：%s", row["id"], getattr(res, "message", res))
                continue
            allow = store.manifest_of(row).get("tools_allow")
            for t in res:
                if allow is not None and t.name not in allow:
                    continue
                desc = f"[{row['name']}] {t.description}".strip()
                out.append(ToolSpec(name=f"{row['id']}__{t.name}", description=desc, input_schema=t.input_schema))
        return out

    async def call_tool(
        self,
        conn: sqlite3.Connection,
        *,
        conversation_id: str,
        name: str,
        arguments: dict[str, Any],
        timeout_s: float = 30.0,
    ) -> ToolResult:
        pid, sep, tool = name.partition("__")
        if not sep or not pid or not tool:
            return ToolResult(text=f"工具名 {name} 不是“插件id__工具名”格式", is_error=True)
        row = store.get_row(conn, pid)
        if row is None:
            return ToolResult(text=f"插件 {pid} 未安装", is_error=True)
        reason = _unavailable_reason(row)
        if reason:
            return ToolResult(text=f"插件 {pid} 不可用：{reason}", is_error=True)
        if conversation_id and not store.conversation_flags(conn, conversation_id).get(pid, True):
            return ToolResult(text=f"插件 {pid} 在本对话里已关闭", is_error=True)
        manifest = store.manifest_of(row)
        allow = manifest.get("tools_allow")
        if allow is not None and tool not in allow:
            return ToolResult(text=f"插件 {pid} 没有开放工具 {tool}", is_error=True)
        spec = store.launch_spec(manifest, store.stored_config(row))
        try:
            raw = await host.call(spec, tool, dict(arguments or {}), timeout=timeout_s, start_timeout=start_timeout())
        except PluginCallTimeout:
            return ToolResult(text=f"PLUGIN_TIMEOUT：插件工具 {name} 超过 {timeout_s:g} s 没有返回", is_error=True)
        except PluginStartError as e:
            return ToolResult(text=f"PLUGIN_SELF_CHECK_FAILED：插件 {pid} 启动失败（{e.message}）", is_error=True)
        except PluginCallError as e:
            return ToolResult(text=f"插件工具 {name} 调用失败：{e}", is_error=True)
        text = _truncate(raw.text)
        if raw.is_error:
            return ToolResult(text=text or f"插件工具 {name} 返回错误", is_error=True)
        evidence = mapping.to_evidence(
            conn,
            plugin_id=pid,
            plugin_name=row["name"],
            tool_name=tool,
            mapping=manifest.get("evidence_mapping"),
            arguments=dict(arguments or {}),
            text=raw.text,
            structured=raw.structured,
        )
        return ToolResult(text=text, evidence=evidence)

    # ---------- 安装、自检、卸载 ----------
    def install(self, conn: sqlite3.Connection, plugin_id: str, patch: dict[str, str]) -> dict:
        row = store.get_row(conn, plugin_id)
        entry = registry.plugin_entry(plugin_id)
        manifest = (entry or {}).get("manifest") or (store.manifest_of(row) if row is not None else None)
        if manifest is None:
            if entry is None:
                raise not_found("插件")
            raise ApiError("VALIDATION_ERROR", f"插件 {plugin_id} 还没有 Mnemosyne 适配清单，暂时不能安装")
        cfg, errors = store.merge_config(manifest, store.stored_config(row), patch)
        if errors:
            raise ApiError("VALIDATION_ERROR", "；".join(errors))
        missing = store.missing_required(manifest, cfg)
        if missing:
            raise ApiError("VALIDATION_ERROR", "缺少必填配置：" + "、".join(missing))
        spec = store.launch_spec(manifest, cfg)
        try:
            tools: list[ToolInfo] = host.self_check(spec, start_timeout())
        except PluginStartError as e:
            if row is not None:  # 已安装的插件：保存这次的配置，状态记为 error
                store.save_installed(conn, manifest, cfg, "error", None, now_iso())
            tail = (e.log_tail + "\n" if e.log_tail else "") + f"[mnemosyne] {e.message}"
            raise ApiError("PLUGIN_SELF_CHECK_FAILED", f"插件自检失败：{e.message}", {"log_tail": tail}) from None
        listed = [{"name": t.name, "description": t.description} for t in tools]
        allow = manifest.get("tools_allow")
        if allow is not None:
            absent = sorted(set(allow) - {t.name for t in tools})
            if absent:
                log.warning("插件 %s 的 tools_allow 里有 tools/list 没返回的工具：%s", plugin_id, absent)
        store.save_installed(conn, manifest, cfg, "installed", listed, now_iso())
        return store.installed_out(store.get_row(conn, plugin_id), _short_names().get(plugin_id))

    def uninstall(self, conn: sqlite3.Connection, plugin_id: str) -> dict:
        if store.get_row(conn, plugin_id) is None:
            raise ApiError("NOT_FOUND", "插件未安装")
        host.stop(plugin_id)
        conn.execute("DELETE FROM conversation_plugins WHERE plugin_id = ?", (plugin_id,))
        conn.execute("DELETE FROM plugins WHERE id = ?", (plugin_id,))
        conn.commit()
        return {"ok": True}

    # ---------- 查询 ----------
    def list_installed(self, conn: sqlite3.Connection) -> list[dict]:
        shorts = _short_names()
        return [store.installed_out(r, shorts.get(r["id"])) for r in store.installed_rows(conn)]

    def detail(self, conn: sqlite3.Connection, plugin_id: str) -> dict:
        row = store.get_row(conn, plugin_id)
        entry = registry.plugin_entry(plugin_id)
        if row is None and entry is None:
            raise not_found("插件")
        entry = entry or {}
        short = entry.get("short_name")
        if row is not None:
            out = store.installed_out(row, short)
            manifest = store.manifest_of(row)
            listed = store.listed_tools(row)
        else:
            manifest = entry.get("manifest") or {}
            out = {
                "id": plugin_id,
                "name": manifest.get("name") or entry.get("name") or plugin_id,
                "version": manifest.get("version") or "",
                "status": "not_installed",
                "permissions": list(manifest.get("permissions") or []),
                "config_schema": manifest.get("env_schema") or {},
            }
            if short:
                out["short_name"] = short
            listed = []
        zh = {t["name"]: t["description"] for t in entry.get("tools") or []}
        if listed:
            tools = [{"name": t["name"], "description": zh.get(t["name"]) or t.get("description") or ""} for t in listed]
        else:
            tools = [{"name": t["name"], "description": t.get("description") or ""} for t in entry.get("tools") or []]
        out["tools"] = tools
        out["verified"] = bool(entry.get("verified"))
        if manifest:
            view = {"transport": manifest.get("transport", "stdio"), "command": manifest.get("command", ""), "args": list(manifest.get("args") or [])}
            if manifest.get("tools_allow") is not None:
                view["tools_allow"] = list(manifest["tools_allow"])
            out["manifest"] = view
        for k in ("about_zh", "usage_zh", "permission_notes"):
            if entry.get(k):
                out[k] = entry[k]
        return out

    def conversation_plugins(self, conn: sqlite3.Connection, cid: str) -> list[dict]:
        _conversation_or_404(conn, cid)
        flags = store.conversation_flags(conn, cid)
        shorts = _short_names()
        out = []
        for r in store.installed_rows(conn):
            reason = _unavailable_reason(r)
            item = {"plugin_id": r["id"], "enabled": flags.get(r["id"], True) and reason is None, "status": r["status"]}
            if reason:
                item["reason"] = reason
            if shorts.get(r["id"]):
                item["short_name"] = shorts[r["id"]]
            out.append(item)
        return out

    def set_conversation_plugins(self, conn: sqlite3.Connection, cid: str, enabled_ids: list[str]) -> list[dict]:
        _conversation_or_404(conn, cid)
        installed = [r["id"] for r in store.installed_rows(conn)]
        unknown = [i for i in enabled_ids if i not in installed]
        if unknown:
            raise ApiError("VALIDATION_ERROR", f"插件 {'、'.join(unknown)} 未安装")
        conn.execute("DELETE FROM conversation_plugins WHERE conversation_id = ?", (cid,))
        conn.executemany(
            "INSERT INTO conversation_plugins (conversation_id, plugin_id, enabled) VALUES (?, ?, ?)",
            [(cid, pid, 1 if pid in enabled_ids else 0) for pid in installed],
        )
        conn.commit()
        return self.conversation_plugins(conn, cid)

    def market(self, conn: sqlite3.Connection, kind: str) -> list[dict]:
        try:
            items = registry.load(kind)
        except registry.RegistryUnavailable as e:
            what = "插件市场" if kind == "plugin" else "Skill 市场"
            raise ApiError("INTERNAL", f"读取{what}失败") from e
        table = "plugins" if kind == "plugin" else "skills"
        installed = {r[0] for r in conn.execute(f"SELECT id FROM {table}")}  # noqa: S608  表名是常量
        out = []
        for x in items:
            item = {k: x[k] for k in registry.MARKET_FIELDS}
            item["installed"] = x["id"] in installed
            if kind == "plugin":
                item["verified"] = bool(x.get("verified"))
                if x.get("short_name"):
                    item["short_name"] = x["short_name"]
            out.append(item)
        return out

    def shutdown(self) -> None:
        host.shutdown()


plugins = PluginRuntime()
