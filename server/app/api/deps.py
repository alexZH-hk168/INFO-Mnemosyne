"""接口共用依赖。"""

from __future__ import annotations

from collections.abc import Iterator
import sqlite3

from app.db.conn import connect


def get_conn() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
