"""建表并写入 schema 版本（契约 scripts.md）。

用法：uv run python scripts/init_db.py --db data/mnemosyne.db
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_config  # noqa: E402
from app.db.conn import SCHEMA_VERSION, connect, init_db  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="初始化 Mnemosyne SQLite 数据库")
    parser.add_argument("--db", default=None, help="数据库路径，默认 MN_DB_PATH 或 server/data/mnemosyne.db")
    args = parser.parse_args()
    db = Path(args.db) if args.db else get_config().db_path
    conn = connect(db)
    try:
        init_db(conn)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        version = conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()
    print(json.dumps({"db": str(db), "schema_version": version, "expected_version": SCHEMA_VERSION, "journal_mode": mode, "tables": tables}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
