"""批量导入材料（契约 scripts.md）：每个文件输出一行 JSON：
document_id, kind, pages, segments, chunks, status, error

用法：
  uv run python scripts/ingest.py --project prj_xxx --path 论文目录/
  uv run python scripts/ingest.py --project prj_xxx --reindex            # 重建该项目全部材料的分块与索引
  uv run python scripts/ingest.py --project prj_xxx --path a.pdf --reindex  # 同一文件（sha256 相同）已导入则重建而不是重复导入
--project 可以是项目 id 或项目名；都不存在时按该名字新建项目。
切换嵌入模型（维度变化）后必须带 --reindex：会按当前配置重建向量表。
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_config  # noqa: E402
from app.db.conn import EmbeddingDimMismatch, connect, init_db, recreate_vec_table, vec_table_dim  # noqa: E402
from app.ids import new_id, now_iso, sha256_file  # noqa: E402
from app.ingest.pipeline import DEFAULT_GROUP, detect_kind, enqueue_parse, run_pending_jobs  # noqa: E402
from app.retrieval.embedder import get_embedder  # noqa: E402


def resolve_project(conn, value: str) -> str:
    row = conn.execute("SELECT id FROM projects WHERE id = ?", (value,)).fetchone()
    if row:
        return row["id"]
    row = conn.execute("SELECT id FROM projects WHERE name = ? ORDER BY created_at LIMIT 1", (value,)).fetchone()
    if row:
        return row["id"]
    pid = new_id("prj")
    conn.execute("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)", (pid, value[:60], now_iso()))
    conn.commit()
    return pid


def iter_files(path: Path):
    if path.is_file():
        yield path
        return
    for p in sorted(path.rglob("*")):
        if p.is_file() and not any(part.startswith(".") for part in p.relative_to(path).parts):
            yield p


def main() -> int:
    parser = argparse.ArgumentParser(description="导入材料并建立检索索引")
    parser.add_argument("--project", required=True)
    parser.add_argument("--path", default=None, help="文件或目录")
    parser.add_argument("--reindex", action="store_true")
    args = parser.parse_args()
    if not args.path and not args.reindex:
        parser.error("需要 --path 或 --reindex")

    config = get_config()
    embedder = get_embedder(config)
    conn = connect(config.db_path)
    try:
        try:
            init_db(conn, config)
        except EmbeddingDimMismatch:
            if not args.reindex:
                raise
            recreate_vec_table(conn, embedder.dim)
        if args.reindex and vec_table_dim(conn) != embedder.dim:
            recreate_vec_table(conn, embedder.dim)
        pid = resolve_project(conn, args.project)
        skipped = []
        targets: list[str] = []
        if args.path:
            for f in iter_files(Path(args.path)):
                kind = detect_kind(f.name)
                if kind is None:
                    skipped.append({"document_id": None, "kind": None, "pages": None, "segments": 0, "chunks": 0, "status": "skipped", "error": f"不支持的文件类型：{f.name}"})
                    continue
                digest = sha256_file(f)
                existing = conn.execute(
                    "SELECT id FROM documents WHERE project_id = ? AND sha256 = ? ORDER BY created_at LIMIT 1", (pid, digest)
                ).fetchone()
                if existing and args.reindex:
                    targets.append(existing["id"])
                    continue
                did = new_id("doc")
                dest = config.files_dir / did / f.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dest)
                conn.execute(
                    'INSERT INTO documents (id, project_id, kind, "group", title, path, sha256, parse_status, created_at) '
                    "VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
                    (did, pid, kind, DEFAULT_GROUP[kind], f.name, str(dest), digest, now_iso()),
                )
                conn.commit()
                targets.append(did)
        else:
            targets = [r["id"] for r in conn.execute("SELECT id FROM documents WHERE project_id = ? AND kind != 'web' ORDER BY created_at", (pid,))]
        for did in targets:
            enqueue_parse(conn, did)
        for line in skipped:
            print(json.dumps(line, ensure_ascii=False))
        results = run_pending_jobs(conn, config, embedder)
        for r in results:
            print(json.dumps(r, ensure_ascii=False))
        return 0 if all(r["status"] == "ready" for r in results) else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
