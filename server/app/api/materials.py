"""材料与证据（rest-api.md“材料与证据”）：文档列表/上传/详情/raw/重新解析、证据、网页快照。"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, Response

from app import models as m
from app.api.deps import get_conn
from app.branch.path import is_evidence_visible, is_snapshot_visible, message_exists, visible_message_ids
from app.config import get_config
from app.errors import ApiError, not_found
from app.ids import new_id, now_iso
from app.ingest.pdf import precheck_pdf
from app.ingest.pipeline import DEFAULT_GROUP, SUPPORTED_HINT, detect_kind, enqueue_parse, preview_pdf_path
from app.ingest.textual import read_text
from app.ingest.types import ParseFailed
from app.repo import cited_by, document_out, evidence_title, message_out

router = APIRouter()

GROUP_ORDER = ["paper", "slides", "code", "notes", "web"]


def _project_or_404(conn: sqlite3.Connection, pid: str) -> None:
    if conn.execute("SELECT 1 FROM projects WHERE id = ?", (pid,)).fetchone() is None:
        raise not_found("项目")


def _document_or_404(conn: sqlite3.Connection, did: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM documents WHERE id = ?", (did,)).fetchone()
    if row is None:
        raise not_found("材料")
    return row


@router.get("/projects/{pid}/documents")
def list_documents(pid: str, conn: sqlite3.Connection = Depends(get_conn)):
    _project_or_404(conn, pid)
    rows = conn.execute("SELECT * FROM documents WHERE project_id = ? ORDER BY created_at, rowid", (pid,)).fetchall()
    by_group: dict[str, list[m.Document]] = {}
    for r in rows:
        by_group.setdefault(r["group"], []).append(document_out(conn, r))
    groups = [m.DocumentGroup(group=g, documents=by_group[g]) for g in GROUP_ORDER if by_group.get(g)]
    return m.dump(m.DocumentGroups(groups=groups))


def _safe_name(name: str) -> str:
    base = Path(name.replace("\\", "/")).name.strip()
    return base or "upload"


@router.post("/projects/{pid}/documents")
def upload_documents(pid: str, file: list[UploadFile] = File(...), conn: sqlite3.Connection = Depends(get_conn)):
    _project_or_404(conn, pid)
    planned = []
    for up in file:
        name = _safe_name(up.filename or "")
        kind = detect_kind(name)
        if kind is None:
            suffix = Path(name).suffix
            what = suffix if suffix else "无扩展名的文件"
            raise ApiError("VALIDATION_ERROR", f"暂不支持 {what}，{SUPPORTED_HINT}")
        planned.append((up, name, kind))
    config = get_config()
    docs, job_ids = [], []
    for up, name, kind in planned:
        did = new_id("doc")
        dest_dir = config.files_dir / did
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / name
        h = hashlib.sha256()
        with open(dest, "wb") as out:
            while True:
                block = up.file.read(1 << 20)
                if not block:
                    break
                h.update(block)
                out.write(block)
        conn.execute(
            'INSERT INTO documents (id, project_id, kind, "group", title, path, sha256, parse_status, created_at) '
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
            (did, pid, kind, DEFAULT_GROUP[kind], name, str(dest), h.hexdigest(), now_iso()),
        )
        job_ids.append(enqueue_parse(conn, did, commit=False))
        conn.commit()
        docs.append(document_out(conn, _document_or_404(conn, did)))
    return m.dump(m.UploadResult(documents=docs, job_ids=job_ids))


@router.get("/documents/{did}")
def get_document(did: str, conn: sqlite3.Connection = Depends(get_conn)):
    return m.dump(document_out(conn, _document_or_404(conn, did)))


def _inline(path: Path, media_type: str, filename: str) -> FileResponse:
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/documents/{did}/raw")
def get_raw(did: str, conn: sqlite3.Connection = Depends(get_conn)):
    doc = _document_or_404(conn, did)
    kind = doc["kind"]
    if kind == "web":
        raise ApiError("NOT_FOUND", "网页材料没有原文件，请读取网页快照")
    path = Path(doc["path"] or "")
    if not path.is_file():
        raise ApiError("NOT_FOUND", "原文件不存在")
    if kind == "pdf":
        return _inline(path, "application/pdf", doc["title"] if doc["title"].lower().endswith(".pdf") else path.name)
    if kind == "pptx":
        preview = preview_pdf_path(path)
        if not preview.is_file():
            raise ApiError("NOT_FOUND", "课件预览 PDF 尚未生成")
        return _inline(preview, "application/pdf", Path(path.name).stem + ".pdf")
    if kind == "ipynb":
        return _inline(path, "application/json", path.name)
    return Response(content=read_text(path), media_type="text/plain; charset=utf-8")


@router.post("/documents/{did}/reparse")
def reparse(did: str, conn: sqlite3.Connection = Depends(get_conn)):
    doc = _document_or_404(conn, did)
    if doc["kind"] == "web":
        raise ApiError("VALIDATION_ERROR", "网页快照不需要重新解析")
    if doc["kind"] == "pdf":
        try:
            precheck_pdf(doc["path"])
        except ParseFailed as e:
            conn.execute("UPDATE documents SET parse_status = 'failed', parse_error = ? WHERE id = ?", (str(e), did))
            conn.commit()
            raise ApiError("PARSE_FAILED", str(e)) from e
        except (OSError, TypeError) as e:
            raise ApiError("PARSE_FAILED", "原文件不存在，无法解析") from e
    if doc["kind"] == "pptx":
        preview = preview_pdf_path(doc["path"])
        if preview.exists():
            preview.unlink()
    return m.dump(m.JobResult(job_id=enqueue_parse(conn, did)))


# ---------- 证据与快照 ----------

def _check_leaf(conn: sqlite3.Connection, leaf_id: str | None) -> None:
    if leaf_id is not None and not message_exists(conn, leaf_id):
        raise ApiError("VALIDATION_ERROR", "leaf_id 不是已有的消息")


def _context_messages(conn: sqlite3.Connection, mid: str, leaf_id: str | None = None) -> list[m.Message]:
    row = conn.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()
    if row is None:
        return []
    visible = visible_message_ids(conn, row["conversation_id"], leaf_id)
    out = []
    if row["parent_id"] and row["parent_id"] in visible:
        parent = conn.execute("SELECT * FROM messages WHERE id = ?", (row["parent_id"],)).fetchone()
        if parent is not None:
            out.append(parent)
    out.append(row)
    children = conn.execute("SELECT * FROM messages WHERE parent_id = ? ORDER BY created_at, rowid", (mid,)).fetchall()
    child = next((c for c in children if c["id"] in visible), None)
    if child is not None:
        out.append(child)
    return [message_out(conn, r) for r in out]


@router.get("/evidence/{eid}")
def get_evidence(eid: str, leaf_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)):
    """leaf_id（v0.4，可选）：按该叶到根的路径判可见性，不给时用 active_leaf_id（规则见 branch/path.py）。"""
    ev = conn.execute("SELECT * FROM evidence WHERE id = ?", (eid,)).fetchone()
    if ev is None:
        raise not_found("证据")
    _check_leaf(conn, leaf_id)
    if not is_evidence_visible(conn, ev, leaf_id):
        raise ApiError("NOT_VISIBLE_ON_PATH", "该证据不在当前分支路径上")
    body = m.Evidence(
        id=ev["id"],
        source_type=ev["source_type"],
        source_id=ev["source_id"],
        title=evidence_title(conn, ev),
        locator=json.loads(ev["locator_json"]),
        quote=ev["quote"],
        sha256=ev["sha256"],
        cited_by=cited_by(conn, eid),
        context_messages=_context_messages(conn, ev["source_id"], leaf_id) if ev["source_type"] == "message" else None,
    )
    return m.dump(body)


@router.get("/web_snapshots/{sid}")
def get_web_snapshot(sid: str, leaf_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)):
    row = conn.execute("SELECT * FROM web_snapshots WHERE id = ?", (sid,)).fetchone()
    if row is None:
        raise not_found("网页快照")
    _check_leaf(conn, leaf_id)
    if not is_snapshot_visible(conn, sid, leaf_id):
        raise ApiError("NOT_VISIBLE_ON_PATH", "该网页快照不在当前分支路径上")
    snap = m.WebSnapshot(
        id=row["id"],
        url=row["url"],
        title=row["title"] or "",
        fetched_at=row["fetched_at"],
        text=row["text"],
        sha256=row["sha256"],
        http_status=row["http_status"] if row["http_status"] is not None else 0,
    )
    return m.dump(snap)
