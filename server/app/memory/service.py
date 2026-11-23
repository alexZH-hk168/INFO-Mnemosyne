"""MemoryService 实现（app/agent/hooks.py 的接口；B2 通过 hooks.get_memory() 拿到本模块的 `memory`）。

- l4_profile(conn, project_id)：L4 画像最新版本正文（只汇总 global 与 project 条目，规则 2），每轮注入系统提示。
- recall(...)：见 app/memory/recall.py。
- on_turn_finished(...)：写一条 extract_memory 任务并唤醒 jobs worker；抽取、比对、写 L3、重写 L2/L4 都在 worker 里异步完成。
  会 commit 当前连接（B2 应在回合落库提交后再调用）。

记忆开关（Settings.memory_enabled，设置接口归 B2）：关闭后不再抽取新记忆，已有记忆保留、仍可召回。
本模块不读 B2 的设置表；B2 合并后把判断函数挂到 `memory.enabled_check = lambda conn: ...`（未挂时默认开启，
也可用环境变量 MN_MEMORY=0 关闭）。见未决 U82。
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Callable

from app.agent.hooks import EvidenceDraft
from app.jobs import worker as jobs
from app.memory import recall as _recall
from app.memory import store


class Memory:
    def __init__(self) -> None:
        self.enabled_check: Callable[[sqlite3.Connection], bool] | None = None

    def enabled(self, conn: sqlite3.Connection) -> bool:
        if os.environ.get("MN_MEMORY", "1") == "0":
            return False
        if self.enabled_check is not None:
            return bool(self.enabled_check(conn))
        return True

    def l4_profile(self, conn: sqlite3.Connection, project_id: str) -> str:
        row = store.latest_summary(conn, "project", project_id)
        return row["content"] if row else ""

    def recall(
        self,
        conn: sqlite3.Connection,
        *,
        project_id: str,
        conversation_id: str,
        leaf_message_id: str | None,
        query: str,
        k: int = 8,
    ) -> list[EvidenceDraft]:
        return _recall.recall(
            conn, project_id=project_id, conversation_id=conversation_id, leaf_message_id=leaf_message_id, query=query, k=k
        )

    def on_turn_finished(self, conn: sqlite3.Connection, *, conversation_id: str, assistant_message_id: str) -> None:
        if not self.enabled(conn):
            return
        jobs.enqueue(conn, "extract_memory", {"conversation_id": conversation_id, "message_id": assistant_message_id}, commit=True)
        jobs.notify()


memory = Memory()
