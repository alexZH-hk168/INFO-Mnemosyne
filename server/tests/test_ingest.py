"""解析流水线：五种材料、失败原因、分块大小、进度。"""

from __future__ import annotations

import json

import pytest

from app.ingest.chunker import build_chunks
from app.ingest.pdf import split_sentences
from app.ingest.textual import parse_code, parse_markdown, parse_notebook
from app.ingest.tokenize import count_tokens, fts_tokens
from tests.conftest import (
    ATTENTION_PDF,
    create_project,
    make_encrypted_pdf,
    make_pptx,
    make_scanned_pdf,
    make_text_pdf,
    upload,
)

needs_attention = pytest.mark.skipif(not ATTENTION_PDF.exists(), reason="先运行 scripts/fetch_test_data.py 下载 arXiv 1706.03762v7")


def _segments(db, did):
    return [
        (r["kind"], r["text"], json.loads(r["locator_json"]))
        for r in db.execute("SELECT * FROM segments WHERE document_id = ? ORDER BY order_idx", (did,))
    ]


# ---------- PDF ----------

@needs_attention
def test_attention_pdf_sentences_and_bbox(client, db, run_jobs):
    pid = create_project(client)
    r = upload(client, pid, [("1706.03762v7.pdf", ATTENTION_PDF.read_bytes())])
    assert r.status_code == 200
    doc = r.json()["documents"][0]
    assert doc["parse_status"] == "queued" and doc["progress"] == 0 and doc["group"] == "paper"
    [summary] = run_jobs()
    assert summary["status"] == "ready", summary
    d = client.get(f"/api/documents/{doc['id']}").json()
    assert d["parse_status"] == "ready" and d["progress"] == 100 and d["pages"] == 15 and d["group"] == "paper"
    segs = _segments(db, doc["id"])
    fn = [s for s in segs if s[2]["page"] == 4 and s[1].startswith("To illustrate why the dot products get large")]
    assert len(fn) == 1, "脚注 4 第一句应单独成句，且去掉了脚注编号"
    loc = fn[0][2]
    assert loc["sentence_ids"][0].startswith("s4_")
    x0, y0, x1, y1 = loc["bbox"]
    # 与 PyMuPDF search_for 量出的文字位置独立核对：句首在 (123.9, 701.9) 附近，句子跨两行到 y≈722
    import pymupdf

    page = pymupdf.open(ATTENTION_PDF)[3]
    hits = page.search_for("To illustrate why the dot products get large")
    tail = page.search_for("variables with mean")
    assert hits and tail
    assert abs(y0 - hits[0].y0) < 1.5 and abs(y1 - tail[0].y1) < 1.5
    assert x0 <= hits[0].x0 + 0.5 and x1 >= hits[0].x1 - 0.5
    assert 0 <= x0 < x1 <= 612 and 0 <= y0 < y1 <= 792  # PDF 坐标系，原点左上，单位 pt


def test_sentence_splitter_keeps_abbreviations():
    text = "We use e.g. dropout. Fig. 3 shows results. Vaswani et al. propose it. 中文句子。第二句！"
    parts = [text[s:e] for s, e in split_sentences(text)]
    assert parts == ["We use e.g. dropout.", "Fig. 3 shows results.", "Vaswani et al. propose it.", "中文句子。", "第二句！"]


def test_landscape_pdf_is_slides(client, run_jobs):
    pid = create_project(client)
    r = upload(client, pid, [("L04 反向传播.pdf", make_text_pdf(["Backpropagation computes gradients layer by layer."] * 4, landscape=True))])
    run_jobs()
    d = client.get(f"/api/documents/{r.json()['documents'][0]['id']}").json()
    assert d["group"] == "slides" and d["parse_status"] == "ready"
    groups = client.get(f"/api/projects/{pid}/documents").json()["groups"]
    assert [g["group"] for g in groups] == ["slides"]


@pytest.mark.parametrize(
    "maker,reason",
    [(make_encrypted_pdf, "PDF 已加密，无法提取文字"), (make_scanned_pdf, "PDF 没有文字层（可能是扫描件），暂不支持 OCR")],
)
def test_unreadable_pdf_parse_failed(maker, reason, client, run_jobs):
    pid = create_project(client)
    did = upload(client, pid, [("bad.pdf", maker())]).json()["documents"][0]["id"]
    [summary] = run_jobs()
    assert summary["status"] == "failed" and summary["error"] == reason
    d = client.get(f"/api/documents/{did}").json()
    assert d["parse_status"] == "failed" and d["parse_error"] == reason
    r = client.post(f"/api/documents/{did}/reparse")
    assert r.status_code == 422
    assert r.json() == {"error": {"code": "PARSE_FAILED", "message": reason, "retriable": True}}


def test_corrupt_pdf_parse_failed(client, run_jobs):
    pid = create_project(client)
    did = upload(client, pid, [("broken.pdf", b"%PDF-1.4 not really a pdf")]).json()["documents"][0]["id"]
    run_jobs()
    d = client.get(f"/api/documents/{did}").json()
    assert d["parse_status"] == "failed" and "无法打开 PDF" in d["parse_error"]


# ---------- PPTX ----------

def test_pptx_shapes_and_preview(client, db, run_jobs):
    pid = create_project(client)
    data = make_pptx([["注意力机制", "softmax 饱和：输入差距过大时输出接近 one-hot", "梯度几乎为 0"], ["位置编码", "sin 与 cos"]])
    did = upload(client, pid, [("L05 注意力机制.pptx", data)]).json()["documents"][0]["id"]
    [summary] = run_jobs()
    assert summary["status"] == "ready", summary
    d = client.get(f"/api/documents/{did}").json()
    assert d["pages"] == 2 and d["group"] == "slides"
    segs = _segments(db, did)
    sat = next(s for s in segs if s[1].startswith("softmax 饱和"))
    loc = sat[2]
    assert loc["slide"] == 1 and isinstance(loc["shape_id"], int)
    # char_range 是该段在形状全文中的码点区间
    from pptx import Presentation
    import io

    shape = next(sh for sh in Presentation(io.BytesIO(data)).slides[0].shapes if sh.shape_id == loc["shape_id"])
    full = "\n".join(p.text for p in shape.text_frame.paragraphs)
    assert full[loc["char_range"][0] : loc["char_range"][1]] == sat[1]
    raw = client.get(f"/api/documents/{did}/raw")
    assert raw.status_code == 200 and raw.headers["content-type"] == "application/pdf" and raw.content.startswith(b"%PDF")
    import pymupdf

    assert pymupdf.open(stream=raw.content, filetype="pdf").page_count == 2


# ---------- 代码 / Notebook / Markdown ----------

PY = '''import math


def attention(q, k, v):
    d_k = q.size(-1)
    return (q @ k.T) / math.sqrt(d_k)


class Encoder:
    """编码器"""

    def __init__(self, n):
        self.n = n

    def forward(self, x):
        return x
'''


def test_code_split_by_function_and_class(tmp_path):
    p = tmp_path / "transformer.py"
    p.write_text(PY, encoding="utf-8")
    res = parse_code(p, "transformer.py")
    locs = [(s.locator["lines"], s.text.splitlines()[0]) for s in res.segments]
    assert locs == [([1, 1], "import math"), ([4, 6], "def attention(q, k, v):"), ([9, 16], "class Encoder:")]
    assert all(s.locator["path"] == "transformer.py" for s in res.segments)
    assert res.extra["lines"] == 16


def test_code_generic_language(tmp_path):
    js = "const a = 1;\n\nfunction foo() {\n  return a;\n}\n\nexport class Bar {\n  x() {}\n}\n"
    p = tmp_path / "x.js"
    p.write_text(js, encoding="utf-8")
    res = parse_code(p, "x.js")
    assert [s.locator["lines"] for s in res.segments] == [[1, 1], [3, 5], [7, 9]]


def test_long_python_function_windows(tmp_path):
    body = "\n".join(f"    x{i} = {i}" for i in range(150))
    p = tmp_path / "long.py"
    p.write_text(f"def big():\n{body}\n", encoding="utf-8")
    res = parse_code(p, "long.py")
    assert [s.locator["lines"] for s in res.segments] == [[1, 60], [61, 120], [121, 151]]


def test_notebook_cells_without_outputs(tmp_path):
    nb = {
        "cells": [
            {"cell_type": "markdown", "source": ["# 训练\n", "说明"]},
            {"cell_type": "code", "source": "loss = train()\nprint(loss)", "outputs": [{"output_type": "stream", "text": ["OUTPUT_SHOULD_NOT_BE_INDEXED"]}]},
            {"cell_type": "code", "source": [], "outputs": []},
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    p = tmp_path / "train.ipynb"
    p.write_text(json.dumps(nb), encoding="utf-8")
    res = parse_notebook(p, "train.ipynb")
    assert res.cells == 3
    assert [(s.locator["cell"], s.locator["lines"]) for s in res.segments] == [(0, [1, 2]), (1, [1, 2])]
    assert all("OUTPUT_SHOULD_NOT_BE_INDEXED" not in s.text for s in res.segments)


def test_markdown_blocks(tmp_path):
    md = "# 注意力笔记\n\n缩放点积的原因。\n第二行。\n\n## 代码\n\n```python\nx = 1\n\ny = 2\n```\n\n- 列表项\n"
    p = tmp_path / "n.md"
    p.write_text(md, encoding="utf-8")
    res = parse_markdown(p, "n.md")
    assert [s.locator["lines"] for s in res.segments] == [[1, 4], [6, 6], [8, 12], [14, 14]]


def test_upload_all_text_kinds(client, run_jobs):
    pid = create_project(client)
    nb = json.dumps({"cells": [{"cell_type": "code", "source": "print(1)", "outputs": []}], "metadata": {}, "nbformat": 4, "nbformat_minor": 5})
    r = upload(client, pid, [("transformer.py", PY.encode()), ("train.ipynb", nb.encode()), ("笔记.md", "# 标题\n\n正文\n".encode())])
    assert r.status_code == 200 and len(r.json()["job_ids"]) == 3
    results = run_jobs()
    assert [x["status"] for x in results] == ["ready"] * 3
    groups = {g["group"]: g["documents"] for g in client.get(f"/api/projects/{pid}/documents").json()["groups"]}
    assert list(groups) == ["code", "notes"]
    code = {d["kind"]: d for d in groups["code"]}
    assert code["code"]["lines"] == 16 and code["ipynb"]["cells"] == 1 and groups["notes"][0]["lines"] == 3
    raw = client.get(f"/api/documents/{code['code']['id']}/raw")
    assert raw.headers["content-type"].startswith("text/plain") and raw.text == PY
    nb_raw = client.get(f"/api/documents/{code['ipynb']['id']}/raw")
    assert nb_raw.headers["content-type"].startswith("text/plain") and nb_raw.text == nb


def test_empty_code_file_fails(client, run_jobs):
    pid = create_project(client)
    did = upload(client, pid, [("empty.py", b"")]).json()["documents"][0]["id"]
    run_jobs()
    d = client.get(f"/api/documents/{did}").json()
    assert d["parse_status"] == "failed" and d["parse_error"] == "文件为空"


# ---------- 分块 ----------

def test_chunks_between_300_and_500_tokens():
    sentences = [(f"s{i}", " ".join(f"word{i}_{j}" for j in range(37)) + ".", {"page": 1 + i // 30}) for i in range(200)]
    chunks = build_chunks(sentences)
    assert all(c.token_count <= 500 for c in chunks)
    assert all(c.token_count >= 300 for c in chunks[:-1])
    # 每个片段恰好出现在一个块里，顺序不变
    assert [sid for c in chunks for sid in c.segment_ids] == [s[0] for s in sentences]


def test_oversized_segment_split():
    long = " ".join(f"w{i}" for i in range(1200))
    chunks = build_chunks([("s1", long, {}), ("s2", "short tail.", {})])
    assert [c.segment_ids for c in chunks] == [["s1"], ["s1"], ["s1"], ["s2"]]
    assert all(c.token_count <= 500 for c in chunks)


def test_tokenizers():
    assert count_tokens("Attention 注意力 is all.") == 7  # Attention / 注 / 意 / 力 / is / all / .
    assert fts_tokens("Scaled Dot-Product 注意力机制") == ["scaled", "dot", "product", "注意", "意力", "力机", "机制"]


@needs_attention
def test_progress_recorded_in_jobs(client, db):
    from app.ingest.pipeline import claim_next_job, run_parse_job

    pid = create_project(client)
    did = upload(client, pid, [("a.pdf", ATTENTION_PDF.read_bytes())]).json()["documents"][0]["id"]
    seen = []
    import app.ingest.pipeline as pl

    orig = pl._set_progress

    def spy(conn, job_id, d, value):
        seen.append(value)
        orig(conn, job_id, d, value)
        if 0 < value < 100:
            seen_doc = client.get(f"/api/documents/{did}").json()
            assert seen_doc["parse_status"] == "parsing" and seen_doc["progress"] == value

    pl._set_progress = spy
    try:
        job = claim_next_job(db)
        run_parse_job(db, job)
    finally:
        pl._set_progress = orig
    assert seen[0] == 0 and seen[-1] >= 90 and seen == sorted(seen) and len(seen) >= 5
    final = client.get(f"/api/documents/{did}").json()
    assert final["parse_status"] == "ready" and final["progress"] == 100
