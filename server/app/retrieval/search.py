"""混合检索：BM25（FTS5）与向量（sqlite-vec）各取前 50，RRF（k=60）融合后取前 8；
以及把命中分块落成证据单元（Evidence）的辅助函数，供 B2 的 search_materials 工具调用。

用户上传材料属于项目，全部可见（data-model.md“分支可见性”），所以这里只按项目与 Scope 过滤，不做分支路径判断。
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field

import sqlite_vec

from app.ids import new_id, now_iso, sha256_text
from app.ingest.tokenize import fts_query, fts_tokens
from app.retrieval.embedder import Embedder, get_embedder

TOP_EACH = 50
RRF_K = 60
TOP_FINAL = 8
VEC_KNN_MAX = 4096  # sqlite-vec 单次 KNN 的 k 上限


@dataclass
class Hit:
    chunk_id: str
    document_id: str
    text: str
    segment_ids: list[str]
    score: float
    bm25_rank: int | None = None
    vec_rank: int | None = None
    extra: dict = field(default_factory=dict)


def _ready_docs(conn: sqlite3.Connection, project_id: str, document_ids: list[str] | None) -> set[str]:
    rows = conn.execute(
        "SELECT id FROM documents WHERE project_id = ? AND parse_status = 'ready' AND kind != 'web'", (project_id,)
    ).fetchall()
    ids = {r["id"] for r in rows}
    if document_ids is not None:
        ids &= set(document_ids)
    return ids


def bm25_search(conn: sqlite3.Connection, project_id: str, query: str, allowed: set[str], limit: int = TOP_EACH, filtered: bool = False) -> list[str]:
    match = fts_query(query)
    if not match or not allowed:
        return []
    rows = conn.execute(
        "SELECT chunk_id, document_id FROM chunks_fts WHERE chunks_fts MATCH ? AND project_id = ? ORDER BY bm25(chunks_fts) LIMIT ?",
        (match, project_id, VEC_KNN_MAX if filtered else limit),
    ).fetchall()
    return [r["chunk_id"] for r in rows if r["document_id"] in allowed][:limit]


def vector_search(conn: sqlite3.Connection, project_id: str, query_vec: list[float], allowed: set[str], limit: int = TOP_EACH, filtered: bool = False) -> list[str]:
    if not allowed:
        return []
    # 只检索部分材料时多取再按 document_id 过滤，保证过滤后仍有至多 limit 条
    k = VEC_KNN_MAX if filtered else limit
    rows = conn.execute(
        "SELECT chunk_id, document_id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ? AND project_id = ? ORDER BY distance",
        (sqlite_vec.serialize_float32(query_vec), k, project_id),
    ).fetchall()
    return [r["chunk_id"] for r in rows if r["document_id"] in allowed][:limit]


def rrf_fuse(rankings: list[list[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, cid in enumerate(ranking, start=1):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))


def hybrid_search(
    conn: sqlite3.Connection,
    project_id: str,
    query: str,
    scope: dict | None = None,
    top_k: int = TOP_FINAL,
    embedder: Embedder | None = None,
) -> list[Hit]:
    """scope 即契约 Scope：{mode: all|selected|none, document_ids?}。mode=none 不检索。"""
    scope = scope or {"mode": "all"}
    mode = scope.get("mode", "all")
    if mode == "none":
        return []
    doc_filter = list(scope.get("document_ids") or []) if mode == "selected" else None
    allowed = _ready_docs(conn, project_id, doc_filter)
    if not allowed or not query.strip():
        return []
    filtered = doc_filter is not None
    embedder = embedder or get_embedder()
    bm = bm25_search(conn, project_id, query, allowed, filtered=filtered)
    vec = vector_search(conn, project_id, embedder.embed([query])[0], allowed, filtered=filtered)
    fused = rrf_fuse([bm, vec])[:top_k]
    bm_rank = {cid: i for i, cid in enumerate(bm, start=1)}
    vec_rank = {cid: i for i, cid in enumerate(vec, start=1)}
    hits: list[Hit] = []
    for cid, score in fused:
        row = conn.execute("SELECT id, document_id, text, segment_ids_json FROM chunks WHERE id = ?", (cid,)).fetchone()
        if row is None:
            continue
        hits.append(
            Hit(
                chunk_id=cid,
                document_id=row["document_id"],
                text=row["text"],
                segment_ids=json.loads(row["segment_ids_json"]),
                score=score,
                bm25_rank=bm_rank.get(cid),
                vec_rank=vec_rank.get(cid),
            )
        )
    return hits


# ---------- 命中 → 证据 ----------

def _overlap(query_tokens: set[str], text: str) -> float:
    toks = set(fts_tokens(text))
    if not toks or not query_tokens:
        return 0.0
    return len(query_tokens & toks) / len(query_tokens)


def pick_segments(conn: sqlite3.Connection, hit: Hit, query: str, max_segments: int = 3) -> list[sqlite3.Row]:
    """在命中分块里挑与查询词面重叠最高的片段，并向前后扩展重叠不低于最高分 50% 的相邻片段（至多 3 个）。"""
    rows = [
        conn.execute("SELECT * FROM segments WHERE id = ?", (sid,)).fetchone() for sid in dict.fromkeys(hit.segment_ids)
    ]
    rows = [r for r in rows if r is not None]
    if not rows:
        return []
    qt = set(fts_tokens(query))
    scores = [_overlap(qt, r["text"]) for r in rows]
    best = max(range(len(rows)), key=lambda i: scores[i])
    chosen = [best]
    lo, hi = best, best
    while len(chosen) < max_segments:
        cands = []
        if lo - 1 >= 0:
            cands.append(lo - 1)
        if hi + 1 < len(rows):
            cands.append(hi + 1)
        cands = [c for c in cands if scores[best] > 0 and scores[c] >= 0.5 * scores[best] and _same_unit(rows[c], rows[best])]
        if not cands:
            break
        nxt = max(cands, key=lambda c: scores[c])
        chosen.append(nxt)
        lo, hi = min(lo, nxt), max(hi, nxt)
    return [rows[i] for i in range(lo, hi + 1)]


def _same_unit(a: sqlite3.Row, b: sqlite3.Row) -> bool:
    la, lb = json.loads(a["locator_json"]), json.loads(b["locator_json"])
    for key in ("page", "slide", "cell"):
        if key in la or key in lb:
            if la.get(key) != lb.get(key):
                return False
    if "shape_id" in la and la.get("shape_id") != lb.get("shape_id"):
        return False
    return True


def merge_locator(locators: list[dict]) -> dict:
    """把同一页/同一形状/同一单元格的若干片段 locator 合成一个契约 locator。"""
    first = locators[0]
    if "page" in first:  # pdf
        boxes = [loc["bbox"] for loc in locators]
        return {
            "page": first["page"],
            "sentence_ids": [sid for loc in locators for sid in loc["sentence_ids"]],
            "bbox": [
                min(b[0] for b in boxes),
                min(b[1] for b in boxes),
                max(b[2] for b in boxes),
                max(b[3] for b in boxes),
            ],
        }
    if "slide" in first:  # pptx
        return {
            "slide": first["slide"],
            "shape_id": first["shape_id"],
            "char_range": [min(loc["char_range"][0] for loc in locators), max(loc["char_range"][1] for loc in locators)],
        }
    merged = {"path": first["path"], "lines": [min(loc["lines"][0] for loc in locators), max(loc["lines"][1] for loc in locators)]}
    if "cell" in first:
        merged["cell"] = first["cell"]
    return merged


def create_material_evidence(conn: sqlite3.Connection, document_id: str, segments: list[sqlite3.Row], commit: bool = True) -> str:
    """由同一材料的连续片段创建一条 source_type=material 的证据，返回 evidence.id。"""
    locs = [json.loads(s["locator_json"]) for s in segments]
    sep = "\n" if "lines" in locs[0] else " "
    quote = sep.join(s["text"] for s in segments)
    eid = new_id("evd")
    conn.execute(
        "INSERT INTO evidence (id, source_type, source_id, locator_json, quote, sha256, created_at, captured_in_message_id) "
        "VALUES (?, 'material', ?, ?, ?, ?, ?, NULL)",
        (eid, document_id, json.dumps(merge_locator(locs), ensure_ascii=False), quote, sha256_text(quote), now_iso()),
    )
    if commit:
        conn.commit()
    return eid


def evidence_for_hit(conn: sqlite3.Connection, hit: Hit, query: str) -> str | None:
    segs = pick_segments(conn, hit, query)
    if not segs:
        return None
    return create_material_evidence(conn, hit.document_id, segs)
