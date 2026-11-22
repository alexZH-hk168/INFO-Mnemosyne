"""测试公共夹具：每个测试一个临时数据目录；默认关闭后台解析线程，用 run_jobs() 同步跑队列。"""

from __future__ import annotations

import io
import json
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "docs" / "contract" / "fixtures"
DATA = Path(__file__).resolve().parent / "data"
ATTENTION_PDF = DATA / "1706.03762v7.pdf"


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("MN_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("MN_DB_PATH", raising=False)
    monkeypatch.setenv("MN_EMBED_BACKEND", "fake")
    monkeypatch.delenv("MN_EMBED_DIM", raising=False)
    monkeypatch.setenv("MN_WORKER", "0")
    return tmp_path


@pytest.fixture
def client(env):
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def db(client):
    from app.db.conn import connect

    conn = connect()
    yield conn
    conn.close()


@pytest.fixture
def run_jobs(db):
    from app.ingest.pipeline import run_pending_jobs

    return lambda: run_pending_jobs(db)


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


# ---------- 测试文件生成 ----------

def make_text_pdf(lines: list[str], landscape: bool = False) -> bytes:
    doc = pymupdf.open()
    w, h = (842, 595) if landscape else (595, 842)
    page = doc.new_page(width=w, height=h)
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=11)
        y += 16
    return doc.tobytes()


def make_encrypted_pdf() -> bytes:
    doc = pymupdf.open(stream=make_text_pdf(["Secret paper body text that should not be readable."] * 3), filetype="pdf")
    buf = io.BytesIO()
    doc.save(buf, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="user-pass", owner_pw="owner-pass")
    return buf.getvalue()


def make_scanned_pdf() -> bytes:
    """只有图片、没有文字层的 PDF（模拟扫描件）。"""
    src = pymupdf.open(stream=make_text_pdf(["This page was scanned from paper."] * 10), filetype="pdf")
    pix = src[0].get_pixmap(dpi=72)
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(page.rect, stream=pix.tobytes("png"))
    return doc.tobytes()


def make_pptx(slides: list[list[str]]) -> bytes:
    from pptx import Presentation
    from pptx.util import Inches

    prs = Presentation()
    for texts in slides:
        slide = prs.slides.add_slide(prs.slide_layouts[5])
        slide.shapes.title.text = texts[0]
        box = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(3))
        tf = box.text_frame
        tf.text = texts[1] if len(texts) > 1 else ""
        for extra in texts[2:]:
            tf.add_paragraph().text = extra
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def create_project(client, name="测试项目") -> str:
    r = client.post("/api/projects", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def upload(client, pid: str, files: list[tuple[str, bytes]]):
    return client.post(
        f"/api/projects/{pid}/documents",
        files=[("file", (name, data, "application/octet-stream")) for name, data in files],
    )
