"""市场、插件与 Skill 接口的请求/响应模型（契约 rest-api.md“市场、插件与 Skill”、types.ts v0.3，加 v0.5 草案 [B3b]）。

放在 B3b 自己的目录里，避免与其他并行分支同时追加 app/models.py 造成合并冲突；基类沿用 app.models.Strict
（extra=forbid）。带 `?` 的契约字段写成 `X | None = None`，序列化时省略（app.models.dump 用 exclude_none）。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.models import Strict

Permission = Literal["network", "fs_read", "fs_write", "exec"]
PluginStatus = Literal["installed", "error", "disabled", "not_installed"]


class ConfigField(Strict):
    required: bool
    secret: bool
    label: str


class MarketItem(Strict):
    id: str
    type: Literal["plugin", "skill"]
    name: str
    owner: str
    official: bool
    stars: int
    stars_date: str
    license: str
    category: str
    desc_zh: str
    repo_url: str
    installed: bool
    verified: bool | None = None  # v0.3，只对插件
    short_name: str | None = None  # v0.5 草案 [B3b]，只对插件


class MarketList(Strict):
    items: list[MarketItem]


class InstalledPlugin(Strict):
    id: str
    name: str
    version: str
    status: PluginStatus
    permissions: list[Permission]
    config_schema: dict[str, ConfigField]
    last_check_at: str | None = None
    config_set: list[str] | None = None  # v0.3
    config: dict[str, str | int | float | bool] | None = None  # v0.3：仅非密钥值
    short_name: str | None = None  # v0.5 草案 [B3b]


class InstalledPluginList(Strict):
    plugins: list[InstalledPlugin]


class PluginTool(Strict):
    name: str
    description: str


class ManifestView(Strict):
    transport: Literal["stdio", "http"]
    command: str
    args: list[str]
    tools_allow: list[str] | None = None


class PermissionNotes(Strict):
    network: str | None = None
    fs_read: str | None = None
    fs_write: str | None = None
    exec: str | None = None


class PluginDetail(InstalledPlugin):
    tools: list[PluginTool]
    verified: bool
    manifest: ManifestView | None = None
    about_zh: str | None = None
    usage_zh: str | None = None
    permission_notes: PermissionNotes | None = None


class ConversationPlugin(Strict):
    plugin_id: str
    enabled: bool
    status: PluginStatus
    reason: str | None = None
    short_name: str | None = None  # v0.5 草案 [B3b]


class ConversationPluginList(Strict):
    plugins: list[ConversationPlugin]


class Skill(Strict):
    id: str
    name: str
    description: str
    dir_path: str
    source_url: str | None = None
    license: str | None = None
    enabled: bool


class SkillList(Strict):
    skills: list[Skill]


class SkillDetail(Skill):
    skill_md: str
    files: list[str]


class OkResult(Strict):
    ok: Literal[True]


# ---------- 请求体 ----------
class InstallPluginBody(BaseModel):
    config: dict[str, str] = {}


class PutConversationPluginsBody(BaseModel):
    enabled_plugin_ids: list[str]


class SkillImportBody(BaseModel):
    source: Literal["github", "local"]
    url: str | None = None
    path: str | None = None


class PutSkillBody(BaseModel):
    enabled: bool
