"""后台任务 worker（B3a）：处理记忆相关的 jobs —— extract_memory、rewrite_digest、rewrite_profile。

- parse_document 由 B1 的 ParseWorker 处理，本 worker 不认领；index_web 暂无处理方（不认领）。
- 单线程、按 created_at 顺序；失败重试，attempts 达到 MAX_ATTEMPTS 后标 failed 并记 error。
- 测试与脚本用 `run_pending_jobs(conn)` 同步跑完队列；服务里由 `JobsWorker` 线程跑，`notify()` 唤醒。
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path

from app.db.conn import connect
from app.ids import new_id, now_iso

log = logging.getLogger("mnemosyne.jobs")

KINDS = ("extract_memory", "rewrite_digest", "rewrite_profile")
MAX_ATTEMPTS = 3
_DEDUP_KINDS = {"rewrite_profile"}  # 同参数已在排队时不重复入队

_wake = threading.Event()


def _handlers() -> dict:
    from app.memory.pipeline import HANDLERS

    return HANDLERS


def enqueue(conn: sqlite3.Connection, kind: str, payload: dict, *, commit: bool = False) -> str:
    if kind not in KINDS:
        raise ValueError(f"未知任务类型：{kind}")
    data = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    if kind in _DEDUP_KINDS:
        row = conn.execute(
            "SELECT id FROM jobs WHERE kind = ? AND status = 'queued' AND payload_json = ?", (kind, data)
        ).fetchone()
        if row:
            return row["id"]
    jid = new_id("job")
    conn.execute(
        "INSERT INTO jobs (id, kind, payload_json, status, attempts, created_at) VALUES (?, ?, ?, 'queued', 0, ?)",
        (jid, kind, data, now_iso()),
    )
    if commit:
        conn.commit()
    return jid


def notify() -> None:
    _wake.set()


def claim_next(conn: sqlite3.Connection) -> sqlite3.Row | None:
    conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        qs = ",".join("?" * len(KINDS))
        row = conn.execute(
            f"SELECT * FROM jobs WHERE kind IN ({qs}) AND status = 'queued' ORDER BY created_at, rowid LIMIT 1", KINDS
        ).fetchone()
        if row is not None:
            conn.execute("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?", (row["id"],))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return row


def run_job(conn: sqlite3.Connection, job: sqlite3.Row) -> dict:
    """执行一个已认领的任务：成功则业务写入与 done 状态一起提交；失败回滚业务写入后重排或标 failed。"""
    payload = json.loads(job["payload_json"] or "{}")
    try:
        result = _handlers()[job["kind"]](conn, payload)
        conn.execute("UPDATE jobs SET status = 'done', error = NULL, finished_at = ? WHERE id = ?", (now_iso(), job["id"]))
        conn.commit()
        return {"job_id": job["id"], "kind": job["kind"], "status": "done", **(result or {})}
    except Exception as e:  # noqa: BLE001 - worker 不能因单个任务崩溃
        conn.rollback()
        log.exception("job %s (%s) failed", job["id"], job["kind"])
        attempts = conn.execute("SELECT attempts FROM jobs WHERE id = ?", (job["id"],)).fetchone()["attempts"]
        status = "failed" if attempts >= MAX_ATTEMPTS else "queued"
        conn.execute(
            "UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?",
            (status, f"{type(e).__name__}: {e}", now_iso() if status == "failed" else None, job["id"]),
        )
        conn.commit()
        return {"job_id": job["id"], "kind": job["kind"], "status": status, "error": str(e)}


def run_pending_jobs(conn: sqlite3.Connection, limit: int = 1000) -> list[dict]:
    """同步跑完队列（测试与脚本用）。"""
    out = []
    for _ in range(limit):
        job = claim_next(conn)
        if job is None:
            break
        out.append(run_job(conn, job))
    return out


def recover_interrupted(conn: sqlite3.Connection) -> None:
    qs = ",".join("?" * len(KINDS))
    conn.execute(f"UPDATE jobs SET status = 'queued' WHERE kind IN ({qs}) AND status = 'running'", KINDS)
    conn.commit()


class JobsWorker(threading.Thread):
    def __init__(self, db_path: Path | str | None = None):
        super().__init__(name="mn-jobs-worker", daemon=True)
        self.db_path = db_path
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()
        _wake.set()

    def run(self) -> None:
        conn = connect(self.db_path)
        try:
            recover_interrupted(conn)
            while not self._stop_event.is_set():
                try:
                    job = claim_next(conn)
                except sqlite3.Error:
                    log.exception("claim job failed")
                    time.sleep(1)
                    continue
                if job is None:
                    _wake.wait(1.0)
                    _wake.clear()
                    continue
                run_job(conn, job)
        finally:
            conn.close()
