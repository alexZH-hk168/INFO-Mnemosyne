"""PPTX 解析：python-pptx 取每页文本框（含组合形状与表格），按段落切成 shape 片段；
LibreOffice 把课件转成 PDF 供右栏预览（`GET /api/documents/{did}/raw` 返回该 PDF）。

locator（契约 evidence-locator.md）：`{slide, shape_id, char_range}`，slide 从 1 开始；
char_range 是段落在该形状全文（段落以 \\n 连接）中的码点区间，左闭右开。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from app.ingest.types import ParseFailed, ParseResult, ProgressFn, Seg, noop_progress


def _shape_text(shape) -> str | None:
    if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
        return "\n".join(p.text if hasattr(p, "text") else "".join(r.text for r in p.runs) for p in shape.text_frame.paragraphs)
    if getattr(shape, "has_table", False) and shape.has_table:
        rows = []
        for row in shape.table.rows:
            rows.append("\t".join(cell.text for cell in row.cells))
        return "\n".join(rows)
    return None


def _iter_shapes(shapes):
    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from _iter_shapes(shape.shapes)
        else:
            yield shape


def parse_pptx(path, progress: ProgressFn = noop_progress) -> ParseResult:
    try:
        prs = Presentation(str(path))
    except Exception as e:  # noqa: BLE001
        raise ParseFailed("无法打开 PPTX：文件损坏或不是 PPTX") from e
    slides = list(prs.slides)
    segs: list[Seg] = []
    for idx, slide in enumerate(slides, start=1):
        for shape in _iter_shapes(slide.shapes):
            text = _shape_text(shape)
            if not text or not text.strip():
                continue
            offset = 0
            for para in text.split("\n"):
                start, end = offset, offset + len(para)
                offset = end + 1
                stripped = para.strip()
                if not stripped:
                    continue
                lead = len(para) - len(para.lstrip())
                s, e = start + lead, start + lead + len(stripped)
                segs.append(Seg("shape", stripped, {"slide": idx, "shape_id": int(shape.shape_id), "char_range": [s, e]}))
        progress(idx / max(1, len(slides)))
    return ParseResult(segments=segs, pages=len(slides), group="slides")


def convert_to_pdf(src: Path, out_pdf: Path, soffice: str, timeout: int = 240) -> None:
    """用 LibreOffice 无界面转换；每次用独立的用户配置目录，避免并发锁。"""
    if not Path(soffice).exists() and not shutil.which(soffice):
        raise ParseFailed("服务器缺少 LibreOffice，无法生成课件预览")
    with tempfile.TemporaryDirectory(prefix="mn_lo_") as tmp:
        profile = Path(tmp) / "profile"
        outdir = Path(tmp) / "out"
        outdir.mkdir()
        cmd = [
            soffice,
            f"-env:UserInstallation=file://{profile}",
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            str(outdir),
            str(src),
        ]
        env = {**os.environ, "HOME": tmp}
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout, env=env)
        except subprocess.TimeoutExpired as e:
            raise ParseFailed("课件转 PDF 超时") from e
        produced = list(outdir.glob("*.pdf"))
        if proc.returncode != 0 or not produced:
            raise ParseFailed("课件转 PDF 失败")
        out_pdf.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(produced[0]), out_pdf)
