"""数据库连接与建表。每个请求/任务各开一个连接；WAL 模式允许 worker 写入时接口并发读取。"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

import sqlite_vec

from app.config import Config, get_config

SCHEMA_VERSION = 1
SCHEMA_PATH = Path(__file__).with_name("schema.sql")


class EmbeddingDimMismatch(RuntimeError):
    pass


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    path = str(db_path or get_config().db_path)
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def vec_table_dim(conn: sqlite3.Connection) -> int | None:
    row = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'chunks_vec'").fetchone()
    if not row:
        return None
    m = re.search(r"float\[(\d+)\]", row["sql"])
    return int(m.group(1)) if m else None


def create_vec_table(conn: sqlite3.Connection, dim: int) -> None:
    if dim <= 0:
        raise EmbeddingDimMismatch("嵌入维度未配置：使用真实嵌入模型时必须设置 MN_EMBED_DIM")
    conn.execute(
        f"""CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
              chunk_id TEXT PRIMARY KEY,
              embedding float[{dim}] distance_metric=cosine,
              project_id TEXT PARTITION KEY,
              +document_id TEXT
            )"""
    )


def init_db(conn: sqlite3.Connection, config: Config | None = None) -> None:
    """建全部表（幂等）并检查向量表维度与当前嵌入配置一致。"""
    config = config or get_config()
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    existing = vec_table_dim(conn)
    if existing is None:
        create_vec_table(conn, config.embed_dim)
    elif config.embed_dim and existing != config.embed_dim:
        raise EmbeddingDimMismatch(
            f"向量表维度为 {existing}，当前嵌入配置为 {config.embed_dim}；"
            "请运行 scripts/ingest.py --reindex 重建索引"
        )
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()


def recreate_vec_table(conn: sqlite3.Connection, dim: int) -> None:
    conn.execute("DROP TABLE IF EXISTS chunks_vec")
    create_vec_table(conn, dim)
    conn.commit()
