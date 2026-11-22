"""解析任务流水线：文件类型判定 → 解析为片段 → 分块 → FTS5 + sqlite-vec 索引；进度写 jobs.payload_json。

进度口径（Document.progress，0–100）：解析阶段占 0–60，PPTX 转预览 PDF 占 60–75，分块与嵌入占 75–100；
就绪后固定为 100。进度存在 jobs.payload_json 的 `progress` 字段（data-model 的 jobs 表没有单独的进度列）。
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path

import sqlite_vec

from app.config import Config, get_config
from app.db.conn import connect
from app.ids import new_id, now_iso
from app.ingest.chunker import build_chunks
from app.ingest.pdf import parse_pdf
from app.ingest.pptx_parser import convert_to_pdf, parse_pptx
from app.ingest.textual import CODE_EXTENSIONS, parse_code, parse_markdown, parse_notebook
from app.ingest.tokenize import fts_body
from app.ingest.types import ParseFailed, ParseResult
from app.retrieval.embedder import Embedder, EmbeddingError, get_embedder

log = logging.getLogger("mnemosyne.ingest")

DEFAULT_GROUP = {"pdf": "paper", "pptx": "slides", "code": "code", "ipynb": "code", "md": "notes", "web": "web"}
SUPPORTED_HINT = "请上传 PDF、PPTX、代码、Notebook 或 Markdown"


def detect_kind(filename: str) -> str | None:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        return "pdf"
    if suffix == ".pptx":
        return "pptx"
    if suffix == ".ipynb":
        return "ipynb"
    if suffix in (".md", ".markdown"):
        return "md"
    if suffix in CODE_EXTENSIONS:
        return "code"
    return None


def preview_pdf_path(doc_path: str | Path) -> Path:
    return Path(doc_path).parent / "preview.pdf"


# ---------- 任务队列 ----------

def active_job_for(conn: sqlite3.Connection, did: str) -> str | None:
    for row in conn.execute(
        "SELECT id, payload_json FROM jobs WHERE kind = 'parse_document' AND status IN ('queued', 'running') ORDER BY created_at"
    ):
        if json.loads(row["payload_json"] or "{}").get("document_id") == did:
            return row["id"]
    return None


def enqueue_parse(conn: sqlite3.Connection, did: str, commit: bool = True) -> str:
    existing = active_job_for(conn, did)
    if existing:
        return existing
    job_id = new_id("job")
    conn.execute(
        "INSERT INTO jobs (id, kind, payload_json, status, attempts, created_at) VALUES (?, 'parse_document', ?, 'queued', 0, ?)",
        (job_id, json.dumps({"document_id": did, "progress": 0}), now_iso()),
    )
    conn.execute("UPDATE documents SET parse_status = 'queued', parse_error = NULL WHERE id = ?", (did,))
    if commit:
        conn.commit()
    notify_worker()
    return job_id


def latest_progress(conn: sqlite3.Connection, did: str) -> int | None:
    """该材料最近一个解析任务的进度。"""
    rows = conn.execute(
        "SELECT payload_json FROM jobs WHERE kind = 'parse_document' AND payload_json LIKE ? ORDER BY created_at DESC, rowid DESC",
        (f'%"{did}"%',),
    ).fetchall()
    for row in rows:
        payload = json.loads(row["payload_json"] or "{}")
        if payload.get("document_id") == did:
            return int(payload.get("progress", 0))
    return None


def _set_progress(conn: sqlite3.Connection, job_id: str, did: str, value: int) -> None:
    conn.execute(
        "UPDATE jobs SET payload_json = ? WHERE id = ?",
        (json.dumps({"document_id": did, "progress": max(0, min(100, int(value)))}), job_id),
    )
    conn.commit()


# ---------- 解析与索引 ----------

def _parse(doc: sqlite3.Row, config: Config, progress) -> ParseResult:
    kind, path = doc["kind"], doc["path"]
    if not path or not Path(path).exists():
        raise ParseFailed("原文件不存在，无法解析")
    if kind == "pdf":
        return parse_pdf(path, lambda f: progress(60 * f))
    if kind == "pptx":
        result = parse_pptx(path, lambda f: progress(60 * f))
        convert_to_pdf(Path(path), preview_pdf_path(path), config.soffice)
        progress(75)
        return result
    if kind == "code":
        return parse_code(path, doc["title"], lambda f: progress(60 * f))
    if kind == "ipynb":
        return parse_notebook(path, doc["title"], lambda f: progress(60 * f))
    if kind == "md":
        return parse_markdown(path, doc["title"], lambda f: progress(60 * f))
    raise ParseFailed(f"不支持解析 {kind} 类型")


def store_index(conn: sqlite3.Connection, doc: sqlite3.Row, result: ParseResult, embedder: Embedder, progress=None) -> tuple[int, int]:
    """在一个事务里替换该材料的全部片段、分块与索引。返回 (片段数, 分块数)。"""
    did, pid = doc["id"], doc["project_id"]
    seg_rows = []
    for idx, seg in enumerate(result.segments):
        seg_rows.append((new_id("seg"), did, seg.kind, seg.text, json.dumps(seg.locator, ensure_ascii=False), idx))
    drafts = build_chunks([(r[0], r[3], json.loads(r[4])) for r in seg_rows])
    if progress:
        progress(80)
    vectors = embedder.embed([d.text for d in drafts]) if drafts else []
    if progress:
        progress(95)
    with _transaction(conn):
        old = [r["id"] for r in conn.execute("SELECT id FROM chunks WHERE document_id = ?", (did,))]
        for cid in old:
            conn.execute("DELETE FROM chunks_vec WHERE chunk_id = ?", (cid,))
        conn.execute("DELETE FROM chunks_fts WHERE document_id = ?", (did,))
        conn.execute("DELETE FROM chunks WHERE document_id = ?", (did,))
        conn.execute("DELETE FROM segments WHERE document_id = ?", (did,))
        conn.executemany(
            "INSERT INTO segments (id, document_id, kind, text, locator_json, order_idx) VALUES (?, ?, ?, ?, ?, ?)", seg_rows
        )
        for draft, vec in zip(drafts, vectors):
            cid = new_id("chk")
            conn.execute(
                "INSERT INTO chunks (id, document_id, text, segment_ids_json, token_count) VALUES (?, ?, ?, ?, ?)",
                (cid, did, draft.text, json.dumps(draft.segment_ids), draft.token_count),
            )
            conn.execute(
                "INSERT INTO chunks_fts (body, chunk_id, project_id, document_id) VALUES (?, ?, ?, ?)",
                (fts_body(draft.text), cid, pid, did),
            )
            conn.execute(
                "INSERT INTO chunks_vec (chunk_id, embedding, project_id, document_id) VALUES (?, ?, ?, ?)",
                (cid, sqlite_vec.serialize_float32(vec), pid, did),
            )
    return len(seg_rows), len(drafts)


class _transaction:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        self.conn.commit()
        self.conn.execute("BEGIN IMMEDIATE")
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.conn.commit()
        else:
            self.conn.rollback()
        return False


def run_parse_job(conn: sqlite3.Connection, job_id: str, config: Config | None = None, embedder: Embedder | None = None) -> dict:
    """执行一个已被认领（status=running）的解析任务；返回 scripts/ingest.py 需要的摘要。"""
    config = config or get_config()
    job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    did = json.loads(job["payload_json"] or "{}").get("document_id")
    doc = conn.execute("SELECT * FROM documents WHERE id = ?", (did,)).fetchone() if did else None
    summary = {"document_id": did, "kind": doc["kind"] if doc else None, "pages": None, "segments": 0, "chunks": 0, "status": "failed", "error": None}
    if doc is None:
        conn.execute("UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", ("材料不存在", now_iso(), job_id))
        conn.commit()
        summary["error"] = "材料不存在"
        return summary
    conn.execute("UPDATE documents SET parse_status = 'parsing', parse_error = NULL WHERE id = ?", (did,))
    conn.commit()
    last = {"v": -100}

    def progress(value: float):
        v = int(value)
        if v - last["v"] >= 5 or v >= 100:
            last["v"] = v
            _set_progress(conn, job_id, did, v)

    progress(0)
    try:
        embedder = embedder or get_embedder(config)
        result = _parse(doc, config, progress)
        n_seg, n_chunk = store_index(conn, doc, result, embedder, progress)
        group = result.group if doc["kind"] == "pdf" and result.group else doc["group"]
        title = result.title or doc["title"]
        conn.execute(
            "UPDATE documents SET parse_status = 'ready', parse_error = NULL, pages = ?, cells = ?, \"group\" = ?, title = ? WHERE id = ?",
            (result.pages, result.cells, group, title, did),
        )
        conn.execute(
            "UPDATE jobs SET status = 'done', error = NULL, finished_at = ?, payload_json = ? WHERE id = ?",
            (now_iso(), json.dumps({"document_id": did, "progress": 100}), job_id),
        )
        conn.commit()
        summary.update(pages=result.pages, segments=n_seg, chunks=n_chunk, status="ready")
    except (ParseFailed, EmbeddingError) as e:
        _fail(conn, job_id, did, str(e))
        summary["error"] = str(e)
    except Exception as e:  # noqa: BLE001 - 任务线程不能因单个文件崩溃
        log.exception("parse job %s failed", job_id)
        _fail(conn, job_id, did, "解析时发生内部错误", detail=f"{type(e).__name__}: {e}")
        summary["error"] = "解析时发生内部错误"
    return summary


def _fail(conn, job_id, did, message, detail=None):
    conn.rollback()
    conn.execute("UPDATE documents SET parse_status = 'failed', parse_error = ? WHERE id = ?", (message, did))
    conn.execute(
        "UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", (detail or message, now_iso(), job_id)
    )
    conn.commit()


def claim_next_job(conn: sqlite3.Connection) -> str | None:
    with _transaction(conn):
        row = conn.execute(
            "SELECT id FROM jobs WHERE kind = 'parse_document' AND status = 'queued' ORDER BY created_at, rowid LIMIT 1"
        ).fetchone()
        if not row:
            return None
        conn.execute("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?", (row["id"],))
    return row["id"]


def run_pending_jobs(conn: sqlite3.Connection, config: Config | None = None, embedder: Embedder | None = None) -> list[dict]:
    """同步跑完队列（脚本与测试用）。"""
    out = []
    while True:
        job_id = claim_next_job(conn)
        if job_id is None:
            return out
        out.append(run_parse_job(conn, job_id, config, embedder))


def recover_interrupted(conn: sqlite3.Connection) -> None:
    """服务重启时把上次中断的任务放回队列。"""
    conn.execute("UPDATE jobs SET status = 'queued' WHERE kind = 'parse_document' AND status = 'running'")
    conn.execute("UPDATE documents SET parse_status = 'queued' WHERE parse_status = 'parsing'")
    conn.commit()


# ---------- 后台线程（单线程，云电脑 4 核，不并发解析） ----------

_wake = threading.Event()


def notify_worker() -> None:
    _wake.set()


class ParseWorker(threading.Thread):
    def __init__(self, db_path: Path | str | None = None):
        super().__init__(name="mn-parse-worker", daemon=True)
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
                    job_id = claim_next_job(conn)
                except sqlite3.Error:
                    log.exception("claim job failed")
                    time.sleep(1)
                    continue
                if job_id is None:
                    _wake.wait(1.0)
                    _wake.clear()
                    continue
                run_parse_job(conn, job_id)
        finally:
            conn.close()
