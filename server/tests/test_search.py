"""混合检索、嵌入适配层、证据生成。"""

from __future__ import annotations

import json

import httpx
import pytest

from app.retrieval.embedder import EmbeddingError, FakeEmbedder, OpenAICompatEmbedder, get_embedder
from app.retrieval.search import RRF_K, evidence_for_hit, hybrid_search, rrf_fuse
from tests.conftest import ATTENTION_PDF, create_project, load_fixture, upload

needs_attention = pytest.mark.skipif(not ATTENTION_PDF.exists(), reason="先运行 scripts/fetch_test_data.py")

NOTES = {
    "softmax.md": "# softmax 饱和\n\n输入差距过大时 softmax 输出接近 one-hot，梯度几乎为 0。\n",
    "rnn.md": "# 循环网络\n\nRNN 按时间步展开，长序列容易梯度消失。\n",
    "cnn.md": "# 卷积\n\n卷积核在图像上滑动，共享权重。\n",
}


def test_rrf_formula():
    fused = dict(rrf_fuse([["a", "b", "c"], ["b", "d"]]))
    assert fused["b"] == pytest.approx(1 / (RRF_K + 2) + 1 / (RRF_K + 1))
    assert fused["a"] == pytest.approx(1 / (RRF_K + 1))
    assert list(dict(rrf_fuse([["a", "b", "c"], ["b", "d"]])))[0] == "b"


def test_fake_embedder_deterministic_and_normalized():
    e = FakeEmbedder(64)
    a, b = e.embed(["dot products grow large", "dot products grow large"])
    assert a == b and len(a) == 64
    assert sum(x * x for x in a) == pytest.approx(1.0)
    c = e.embed(["完全无关的句子"])[0]
    sim_same = sum(x * y for x, y in zip(a, e.embed(["the dot products get large"])[0]))
    sim_other = sum(x * y for x, y in zip(a, c))
    assert sim_same > sim_other


def test_openai_compat_embedder_uses_endpoint_without_network():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        body = json.loads(request.content)
        seen["body"] = body
        return httpx.Response(200, json={"data": [{"index": i, "embedding": [0.1, 0.2, 0.3]} for i in range(len(body["input"]))]})

    e = OpenAICompatEmbedder("https://example.invalid/v1", "emb-model", "sk-test", 3, transport=httpx.MockTransport(handler))
    out = e.embed(["a", "b"])
    assert out == [[0.1, 0.2, 0.3], [0.1, 0.2, 0.3]]
    assert seen["url"] == "https://example.invalid/v1/embeddings"
    assert seen["auth"] == "Bearer sk-test"
    assert seen["body"] == {"model": "emb-model", "input": ["a", "b"]}


def test_openai_compat_embedder_errors_hide_key():
    e = OpenAICompatEmbedder("https://example.invalid/v1", "m", "sk-secret", 3, transport=httpx.MockTransport(lambda r: httpx.Response(401)))
    with pytest.raises(EmbeddingError) as exc:
        e.embed(["x"])
    assert "401" in str(exc.value) and "sk-secret" not in str(exc.value)
    bad_dim = OpenAICompatEmbedder("https://x/v1", "m", "", 4, transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0]}]})))
    with pytest.raises(EmbeddingError):
        bad_dim.embed(["x"])


def test_get_embedder_from_env(monkeypatch):
    monkeypatch.setenv("MN_EMBED_BACKEND", "fake")
    monkeypatch.delenv("MN_EMBED_DIM", raising=False)
    assert get_embedder().dim == 256
    monkeypatch.setenv("MN_EMBED_BACKEND", "openai")
    monkeypatch.setenv("MN_EMBED_API_BASE", "https://example.invalid/v1")
    monkeypatch.setenv("MN_EMBED_MODEL", "text-embedding-3-small")
    monkeypatch.setenv("MN_EMBED_DIM", "1536")
    e = get_embedder()
    assert isinstance(e, OpenAICompatEmbedder) and e.dim == 1536
    monkeypatch.delenv("MN_EMBED_DIM")
    with pytest.raises(EmbeddingError):
        get_embedder()


def _ingest_notes(client, run_jobs):
    pid = create_project(client)
    r = upload(client, pid, [(n, t.encode()) for n, t in NOTES.items()])
    run_jobs()
    ids = {d["title"]: d["id"] for d in r.json()["documents"]}
    return pid, ids


def test_hybrid_search_scope(client, db, run_jobs):
    pid, ids = _ingest_notes(client, run_jobs)
    hits = hybrid_search(db, pid, "softmax 梯度为什么几乎为 0")
    assert hits and hits[0].document_id == ids["softmax.md"]
    assert hits[0].bm25_rank == 1 and hits[0].vec_rank is not None
    assert len(hits) <= 8
    sel = hybrid_search(db, pid, "softmax 梯度", {"mode": "selected", "document_ids": [ids["rnn.md"]]})
    assert {h.document_id for h in sel} == {ids["rnn.md"]}
    assert hybrid_search(db, pid, "softmax", {"mode": "none"}) == []
    other = create_project(client, "另一个项目")
    assert hybrid_search(db, other, "softmax") == []


def test_search_excludes_unready_documents(client, db, run_jobs):
    pid, ids = _ingest_notes(client, run_jobs)
    db.execute("UPDATE documents SET parse_status = 'parsing' WHERE id = ?", (ids["softmax.md"],))
    db.commit()
    assert all(h.document_id != ids["softmax.md"] for h in hybrid_search(db, pid, "softmax 饱和"))


def test_top8_from_50_each(client, db, run_jobs):
    pid = create_project(client)
    files = [(f"n{i}.md", f"# 第 {i} 节\n\nattention note number {i} about softmax scaling.\n".encode()) for i in range(60)]
    upload(client, pid, files)
    run_jobs()
    from app.retrieval.search import bm25_search, vector_search, _ready_docs
    from app.retrieval.embedder import get_embedder

    allowed = _ready_docs(db, pid, None)
    assert len(bm25_search(db, pid, "softmax scaling", allowed)) == 50
    assert len(vector_search(db, pid, get_embedder().embed(["softmax scaling"])[0], allowed)) == 50
    assert len(hybrid_search(db, pid, "softmax scaling")) == 8


@needs_attention
def test_attention_footnote_retrievable_with_locator(client, db, run_jobs):
    pid = create_project(client)
    did = upload(client, pid, [("1706.03762v7.pdf", ATTENTION_PDF.read_bytes())]).json()["documents"][0]["id"]
    run_jobs()
    query = "why do the dot products get large"
    hits = hybrid_search(db, pid, query)
    assert hits[0].document_id == did
    eid = evidence_for_hit(db, hits[0], query)
    ev = client.get(f"/api/evidence/{eid}").json()
    assert ev["source_type"] == "material" and ev["source_id"] == did
    assert ev["quote"].startswith("To illustrate why the dot products get large")
    assert ev["locator"]["page"] == 4
    assert ev["title"] == "1706.03762v7"  # PDF 元数据没有标题，用文件名（去扩展名）
    bbox = ev["locator"]["bbox"]
    assert 100 < bbox[0] < 125 and 695 < bbox[1] < 705 and 500 < bbox[2] < 510 and 718 < bbox[3] < 726


F0_PLACEHOLDER_BBOX = [107.6, 640.3, 504.2, 684.9]  # F0 写进 fixture 的占位值，F4 实测值合并后会被替换
_FIXTURE_BBOX = load_fixture("get-evidence-eid.ok")["body"]["locator"]["bbox"]


@needs_attention
@pytest.mark.xfail(
    _FIXTURE_BBOX == F0_PLACEHOLDER_BBOX,
    strict=True,
    reason="fixture 里的 bbox 仍是 F0 占位值；F4 实测值合并进 fixtures 后自动变为正常断言（容差 2 pt）",
)
def test_footnote_bbox_matches_fixture(client, db, run_jobs):
    pid = create_project(client)
    did = upload(client, pid, [("1706.03762v7.pdf", ATTENTION_PDF.read_bytes())]).json()["documents"][0]["id"]
    run_jobs()
    rows = [
        json.loads(r["locator_json"])
        for r in db.execute("SELECT * FROM segments WHERE document_id = ? ORDER BY order_idx", (did,))
        if json.loads(r["locator_json"])["page"] == 4
    ]
    texts = [r["text"] for r in db.execute("SELECT text, locator_json FROM segments WHERE document_id = ? ORDER BY order_idx", (did,)) if json.loads(r["locator_json"])["page"] == 4]
    i = next(k for k, t in enumerate(texts) if t.startswith("To illustrate why"))
    two = [rows[i]["bbox"], rows[i + 1]["bbox"]]  # 脚注 4 两句（与 fixture sentence_ids 两句对应）
    union = [min(b[0] for b in two), min(b[1] for b in two), max(b[2] for b in two), max(b[3] for b in two)]
    expected = load_fixture("get-evidence-eid.ok")["body"]["locator"]["bbox"]
    assert all(abs(a - b) <= 2.0 for a, b in zip(union, expected)), (union, expected)
