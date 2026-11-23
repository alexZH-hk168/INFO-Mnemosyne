"""Agent 回合与 B3 各子系统之间的接口（编排 Agent 2026-11-23 定，供 B2 / B3a / B3b 并行开发）。

规则：
- B2（Agent 主回路）只通过本文件的 get_memory() / get_plugins() / get_skills() 调用记忆、插件、Skill，
  不直接 import app.memory / app.plugins / app.skills。
- B3a 在 `app/memory/service.py` 提供模块级对象 `memory`（实现 MemoryService）。
- B3b 在 `app/plugins/runtime.py` 提供模块级对象 `plugins`（实现 PluginService），
  在 `app/skills/service.py` 提供模块级对象 `skills`（实现 SkillService）。
- 对应模块还不存在时，返回 Null 实现（空结果），所以 B2 可以先独立开发与测试。
- 修改本文件里的签名需要编排 Agent 同意（写进 docs/PROGRESS.md 未决并停下问）。
"""

from __future__ import annotations

import importlib
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class EvidenceDraft:
    """工具返回的一条候选证据；B2 负责落库为 evidence 行并编号 E1…Ek。

    kind 与 locator 必须符合 docs/contract/evidence-locator.md。
    """

    kind: str  # 'material' | 'web' | 'message' | 'plugin'
    source_id: str  # document_id / snapshot_id / message_id / plugin_id
    quote: str
    locator: dict[str, Any] = field(default_factory=dict)
    title: str = ""
    score: float | None = None


@dataclass
class ToolSpec:
    name: str  # 插件工具用 `插件id__工具名`
    description: str
    input_schema: dict[str, Any]


@dataclass
class ToolResult:
    text: str  # 给模型看的文本（已截断）
    evidence: list[EvidenceDraft] = field(default_factory=list)
    is_error: bool = False


class MemoryService(Protocol):
    def l4_profile(self, conn: sqlite3.Connection, project_id: str) -> str: ...

    def recall(
        self,
        conn: sqlite3.Connection,
        *,
        project_id: str,
        conversation_id: str,
        leaf_message_id: str | None,
        query: str,
        k: int = 8,
    ) -> list[EvidenceDraft]: ...

    def on_turn_finished(self, conn: sqlite3.Connection, *, conversation_id: str, assistant_message_id: str) -> None:
        """回合结束后调用；B3a 在这里写 jobs（extract_memory 等）。"""
        ...


class PluginService(Protocol):
    async def list_tools(self, conn: sqlite3.Connection, *, conversation_id: str) -> list[ToolSpec]: ...

    async def call_tool(
        self,
        conn: sqlite3.Connection,
        *,
        conversation_id: str,
        name: str,
        arguments: dict[str, Any],
        timeout_s: float = 30.0,
    ) -> ToolResult: ...


class SkillService(Protocol):
    def list_enabled(self, conn: sqlite3.Connection, *, project_id: str) -> list[dict[str, str]]:
        """返回 [{id, name, summary}]，进系统提示。"""
        ...

    def load(self, conn: sqlite3.Connection, *, skill_id: str) -> str:
        """返回 SKILL.md 正文（渐进加载）。"""
        ...


class _NullMemory:
    def l4_profile(self, conn, project_id):
        return ""

    def recall(self, conn, *, project_id, conversation_id, leaf_message_id, query, k=8):
        return []

    def on_turn_finished(self, conn, *, conversation_id, assistant_message_id):
        return None


class _NullPlugins:
    async def list_tools(self, conn, *, conversation_id):
        return []

    async def call_tool(self, conn, *, conversation_id, name, arguments, timeout_s=30.0):
        return ToolResult(text=f"插件工具 {name} 不可用", is_error=True)


class _NullSkills:
    def list_enabled(self, conn, *, project_id):
        return []

    def load(self, conn, *, skill_id):
        return ""


def _load(module: str, attr: str, default: Any) -> Any:
    try:
        return getattr(importlib.import_module(module), attr)
    except (ImportError, AttributeError):
        return default


def get_memory() -> MemoryService:
    return _load("app.memory.service", "memory", _NullMemory())


def get_plugins() -> PluginService:
    return _load("app.plugins.runtime", "plugins", _NullPlugins())


def get_skills() -> SkillService:
    return _load("app.skills.service", "skills", _NullSkills())
