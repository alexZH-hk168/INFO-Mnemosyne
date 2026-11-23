"""SSE 事件的唯一出口（DEVELOPMENT.md：事件全部经这里发出，自动带 seq 并写入 message_events 以支持续流）。

- EventEmitter.emit()：给事件编 seq（同一条助手消息内从 1 递增）、写 message_events、唤醒正在等待的订阅者。
- TurnHandle / registry：进程内正在运行的回合（用于取消、续流时跟随实时事件）。
- stream_events()：订阅一条助手消息的事件流：先补发 seq > after_seq 的已存事件，回合还在跑就继续跟随，
  直到 message.end 或 error；空闲 15 s 发一行注释 `: ping`（sse-events.md“心跳”）。
回合与 HTTP 连接解耦：客户端断线不会中断回合，重连后用 after_seq 续上。
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from typing import AsyncIterator

from app.db.conn import connect

TERMINAL = ("message.end", "error")
HEARTBEAT_S = 15.0


class TurnHandle:
    """一个正在运行的回合。phase：running → verifying（引用校验）→ saving（写库，之后不再响应取消）→ finished。"""

    def __init__(self, message_id: str):
        self.message_id = message_id
        self.phase = "running"
        self.cancel_requested = False
        self.started = False
        self.task: asyncio.Task | None = None
        self._changed = asyncio.Event()

    def waiter(self) -> asyncio.Event:
        return self._changed

    def notify(self) -> None:
        ev, self._changed = self._changed, asyncio.Event()
        ev.set()

    def request_cancel(self) -> bool:
        if self.phase not in ("running", "verifying") or self.cancel_requested:
            return False
        self.cancel_requested = True
        if self.started and self.task is not None and not self.task.done():
            self.task.cancel()
        return True

    @property
    def finished(self) -> bool:
        return self.phase == "finished"


class Registry:
    def __init__(self) -> None:
        self._turns: dict[str, TurnHandle] = {}

    def register(self, message_id: str) -> TurnHandle:
        h = TurnHandle(message_id)
        self._turns[message_id] = h
        return h

    def get(self, message_id: str) -> TurnHandle | None:
        return self._turns.get(message_id)

    def remove(self, message_id: str) -> None:
        self._turns.pop(message_id, None)

    def running(self) -> list[str]:
        return list(self._turns)


registry = Registry()


def _clean(data: dict) -> dict:
    return {k: v for k, v in data.items() if v is not None}


class EventEmitter:
    def __init__(self, conn: sqlite3.Connection, message_id: str, handle: TurnHandle | None = None):
        self.conn = conn
        self.message_id = message_id
        self.handle = handle
        row = conn.execute("SELECT MAX(seq) FROM message_events WHERE message_id = ?", (message_id,)).fetchone()
        self.seq = int(row[0] or 0)

    def emit(self, event: str, data: dict) -> dict:
        self.seq += 1
        payload = _clean(data)
        payload["seq"] = self.seq
        self.conn.execute(
            "INSERT INTO message_events (message_id, seq, event, data_json) VALUES (?, ?, ?, ?)",
            (self.message_id, self.seq, event, json.dumps(payload, ensure_ascii=False)),
        )
        self.conn.commit()
        if self.handle is not None:
            self.handle.notify()
        return payload


def format_sse(event: str, data_json: str) -> str:
    return f"event: {event}\ndata: {data_json}\n\n"


def has_terminal(conn: sqlite3.Connection, message_id: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM message_events WHERE message_id = ? AND event IN ('message.end', 'error') LIMIT 1", (message_id,)
        ).fetchone()
        is not None
    )


async def stream_events(message_id: str, after_seq: int = 0, *, heartbeat: float = HEARTBEAT_S) -> AsyncIterator[str]:
    conn = connect()
    try:
        last = after_seq
        while True:
            handle = registry.get(message_id)
            waiter = handle.waiter() if handle is not None else None
            rows = conn.execute(
                "SELECT seq, event, data_json FROM message_events WHERE message_id = ? AND seq > ? ORDER BY seq",
                (message_id, last),
            ).fetchall()
            for r in rows:
                last = r["seq"]
                yield format_sse(r["event"], r["data_json"])
                if r["event"] in TERMINAL:
                    return
            if handle is None:
                if rows:
                    continue  # 回合刚结束：再查一次，拿到 message.end
                if last > 0 and not has_terminal(conn, message_id):
                    # 有事件却没有结束事件，回合也不在运行（例如服务重启）：补一条 error 收尾
                    payload = EventEmitter(conn, message_id).emit(
                        "error", {"code": "INTERNAL", "message": "回答在服务重启时中断，请重新生成", "retriable": True}
                    )
                    yield format_sse("error", json.dumps(payload, ensure_ascii=False))
                return
            try:
                await asyncio.wait_for(waiter.wait(), timeout=heartbeat)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
    finally:
        conn.close()
