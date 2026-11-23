"""记忆读路径：recall_memory(query) 在 L3 条目与 L2 对话摘要上混合检索，按作用域与当前分支路径过滤（规则见 branch/path.py）。

混合检索＝词面（与材料检索同一套分词：拉丁词 + 中文二元组）与本地哈希向量余弦两路排名做 RRF 融合。
记忆条目量小，向量在召回时现算，不建索引。
TODO(U2 定下嵌入模型后)：向量改用真实嵌入并缓存到表里；在此之前只用本地 FakeEmbedder，不发起任何付费嵌入调用。

“默认只返回 active 条目”；查询里有“以前 / 之前 / 原来 / 过去 / used to …”这类回溯词时，被 SUPERSEDE 的历史版本也进候选，
这样“我以前喜欢什么”能取回旧条目及其有效期。

返回的 EvidenceDraft（kind=message，指回 L1 原文，locator 符合 evidence-locator.md）：
- source_id / locator.message_id：条目的来源消息（取当前路径上可见的那条）；L2 摘要取 upto_message_id。
- quote：那条消息去标记后的原文（最多 QUOTE_MAX 字），char_range 与之对应 —— 引用校验与右栏定位都以 L1 为准。
- title：记忆本身，形如“历史对话 · 偏好：用户喜欢A（已过时：2026-… 至 2026-…）”，供模型阅读；B2 应把 title 与 quote 一起给模型。
"""

from __future__ import annotations

import json
import math
import re
import sqlite3

from app.agent.hooks import EvidenceDraft
from app.branch.path import digest_visible, is_message_visible, memory_item_visible, visible_branch_ids
from app.ingest.tokenize import fts_tokens
from app.memory.pipeline import plain
from app.retrieval.embedder import FakeEmbedder

QUOTE_MAX = 300
RRF_K = 60
HISTORY_CUE = re.compile(r"以前|之前|曾经|原来|过去|上次|早先|当初|改之前|旧的|used to|previously|earlier|before", re.I)

_embedder = FakeEmbedder()


def has_history_cue(query: str) -> bool:
    return bool(HISTORY_CUE.search(query or ""))


def _cos(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _lex(qtok: set[str], text: str) -> float:
    if not qtok:
        return 0.0
    return len(qtok & set(fts_tokens(text))) / len(qtok)


def _validity(row: sqlite3.Row) -> str:
    if row["status"] == "superseded":
        return f"已过时：{row['valid_from'] or '?'} 至 {row['valid_to'] or '?'}"
    return f"当前有效，自 {row['valid_from'] or '?'}"


def _source_for(conn: sqlite3.Connection, ids: list[str], conversation_id: str, leaf: str | None) -> str | None:
    """来源消息中第一条在路径上可见的（同对话按 leaf，跨对话按那个对话的 active_leaf_id）。"""
    for mid in ids:
        row = conn.execute("SELECT conversation_id FROM messages WHERE id = ?", (mid,)).fetchone()
        if row is None:
            continue
        if is_message_visible(conn, mid, leaf if row["conversation_id"] == conversation_id else None):
            return mid
    return None


def _draft(conn: sqlite3.Connection, mid: str, title: str, score: float) -> EvidenceDraft | None:
    row = conn.execute("SELECT content FROM messages WHERE id = ?", (mid,)).fetchone()
    if row is None:
        return None
    text = plain(row["content"])
    quote = text[:QUOTE_MAX]
    return EvidenceDraft(
        kind="message", source_id=mid, quote=quote, locator={"message_id": mid, "char_range": [0, len(quote)]},
        title=title, score=round(score, 4),
    )


def recall(
    conn: sqlite3.Connection, *, project_id: str, conversation_id: str, leaf_message_id: str | None, query: str, k: int = 8
) -> list[EvidenceDraft]:
    branch_ids = visible_branch_ids(conn, conversation_id, leaf_message_id)
    history = has_history_cue(query)
    statuses = ("active", "superseded") if history else ("active",)
    qs = ",".join("?" * len(statuses))
    rows = conn.execute(
        f"SELECT * FROM memory_items WHERE status IN ({qs}) AND (scope = 'global' OR (scope = 'project' AND scope_id = ?) "
        "OR scope = 'branch') ORDER BY created_at, rowid",
        (*statuses, project_id),
    ).fetchall()
    # 候选：(key, 检索文本, 来源消息 id, 标题, 加分)
    cands: list[tuple[str, str, str, str, float]] = []
    for r in rows:
        if not memory_item_visible(r, project_id=project_id, branch_ids=branch_ids):
            continue
        src = _source_for(conn, json.loads(r["source_message_ids_json"] or "[]"), conversation_id, leaf_message_id)
        if src is None:  # 来源只在本对话别的分支或锚点之后：不在这条路径上，不召回
            continue
        title = f"历史对话 · {r['topic']}：{r['content']}（{_validity(r)}）"
        bonus = 0.1 if (history and r["status"] == "superseded") else 0.0
        cands.append((r["id"], f"{r['topic']} {r['content']}", src, title, bonus))

    # L2：每段对话 / 每个分支取路径上可见的最新一份摘要
    seen: set[tuple[str, str | None]] = set()
    for d in conn.execute(
        "SELECT d.* FROM conversation_digests d JOIN conversations c ON c.id = d.conversation_id "
        "WHERE c.project_id = ? ORDER BY d.updated_at DESC, d.rowid DESC",
        (project_id,),
    ):
        key = (d["conversation_id"], d["branch_id"])
        if key in seen or not digest_visible(conn, d, conversation_id=conversation_id, leaf_id=leaf_message_id):
            continue
        seen.add(key)
        cands.append((d["id"], d["content"], d["upto_message_id"], f"历史对话摘要：{d['content']}", 0.0))

    if not cands:
        return []
    qtok = set(fts_tokens(query or ""))
    qvec = _embedder.embed([query or ""])[0]
    vecs = _embedder.embed([c[1] for c in cands])
    lex = [_lex(qtok, c[1]) for c in cands]
    cos = [_cos(qvec, v) for v in vecs]
    rank_lex = sorted(range(len(cands)), key=lambda i: -lex[i])
    rank_vec = sorted(range(len(cands)), key=lambda i: -cos[i])
    fused = [0.0] * len(cands)
    for ranking in (rank_lex, rank_vec):
        for pos, i in enumerate(ranking):
            fused[i] += 1.0 / (RRF_K + pos + 1)
    order = sorted(
        (i for i in range(len(cands)) if lex[i] > 0 or cos[i] >= 0.3),  # 两路都不相关的不返回
        key=lambda i: -(fused[i] + cands[i][4] * 0.01),
    )
    out: list[EvidenceDraft] = []
    for i in order[:k]:
        d = _draft(conn, cands[i][2], cands[i][3], fused[i] + cands[i][4] * 0.01)
        if d is not None:
            out.append(d)
    return out
