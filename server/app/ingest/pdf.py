"""PDF 解析：PyMuPDF rawdict 逐字符取框，按文字块拼文本、切句，句子 bbox＝句内非空白字符框的并集。

坐标系与单位按契约 evidence-locator.md：PDF 坐标 [x0, y0, x1, y1]，原点左上，单位 pt（PyMuPDF 默认）。
句子 ID 为 `s{页}_{序号}`，页内从 1 开始。
"""

from __future__ import annotations

import re

import pymupdf

from app.ingest.types import ParseFailed, ParseResult, ProgressFn, Seg, noop_progress

ENCRYPTED_MSG = "PDF 已加密，无法提取文字"
NO_TEXT_MSG = "PDF 没有文字层（可能是扫描件），暂不支持 OCR"
BROKEN_MSG = "无法打开 PDF：文件损坏或不是 PDF"

_FLAGS = pymupdf.TEXTFLAGS_RAWDICT & ~pymupdf.TEXT_PRESERVE_LIGATURES
_MIN_TEXT_CHARS_PER_PAGE = 30

_ABBR = {
    "e.g", "i.e", "et al", "al", "fig", "figs", "eq", "eqs", "vs", "etc", "cf", "sec", "no",
    "dr", "mr", "mrs", "ms", "prof", "approx", "resp", "ref", "refs", "tab", "vol", "pp", "ch",
}
_CLOSERS = "\"'”’)]}"
_CJK_END = "。！？"


def _open(path) -> pymupdf.Document:
    try:
        doc = pymupdf.open(path)
    except Exception as e:  # noqa: BLE001 - PyMuPDF 抛多种异常类型
        raise ParseFailed(BROKEN_MSG) from e
    if not doc.is_pdf:
        raise ParseFailed(BROKEN_MSG)
    if doc.needs_pass:
        raise ParseFailed(ENCRYPTED_MSG)
    if doc.page_count == 0:
        raise ParseFailed("PDF 没有页面")
    return doc


def precheck_pdf(path, max_pages: int = 10) -> None:
    """快速检查（重新解析前同步调用）：加密、损坏、前若干页都没有文字层时抛 ParseFailed。"""
    doc = _open(path)
    try:
        for pno in range(min(doc.page_count, max_pages)):
            if len("".join(doc[pno].get_text().split())) >= _MIN_TEXT_CHARS_PER_PAGE:
                return
        if doc.page_count <= max_pages:
            raise ParseFailed(NO_TEXT_MSG)
    finally:
        doc.close()


def split_sentences(text: str) -> list[tuple[int, int]]:
    """返回句子区间 [start, end)（已去掉首尾空白）。"""
    bounds: list[tuple[int, int]] = []
    start = 0
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        cut = None
        if ch in _CJK_END:
            j = i + 1
            while j < n and text[j] in _CLOSERS:
                j += 1
            cut = j
        elif ch in ".!?":
            j = i + 1
            while j < n and text[j] in _CLOSERS:
                j += 1
            if j >= n:
                cut = j
            elif text[j].isspace():
                k = j
                while k < n and text[k].isspace():
                    k += 1
                nxt = text[k] if k < n else ""
                if nxt and (nxt.isupper() or nxt.isdigit() or nxt in "([“\"'" or "\u4e00" <= nxt <= "\u9fff"):
                    if ch != "." or not _is_abbreviation(text, i):
                        cut = j
        if cut is not None:
            _push(bounds, text, start, cut)
            start = cut
            i = cut
            continue
        i += 1
    _push(bounds, text, start, n)
    return bounds


def _is_abbreviation(text: str, dot: int) -> bool:
    m = re.search(r"([A-Za-z][A-Za-z.]*)$", text[:dot])
    if not m:
        return False
    word = m.group(1)
    if len(word) == 1 and word.isupper():
        return True  # 姓名缩写 “A. Vaswani”
    if word.lower().rstrip(".") in _ABBR:
        return True
    tail = text[max(0, dot - 6) : dot].lower()
    return tail.endswith("et al")


def _push(bounds, text, s, e):
    while s < e and text[s].isspace():
        s += 1
    while e > s and text[e - 1].isspace():
        e -= 1
    if e > s and any(c.isalnum() for c in text[s:e]):
        bounds.append((s, e))


def _block_chars(block: dict) -> list[tuple[str, tuple | None]]:
    """把一个文字块拼成 (字符, 框) 序列；行间补空格，处理断词连字符与上标。"""
    chars: list[tuple[str, tuple | None]] = []
    for line in block["lines"]:
        line_chars: list[tuple[str, tuple | None]] = []
        space_after_sup = False
        spans = [s for s in line["spans"] if s["chars"]]
        if not spans:
            continue
        main = max(spans, key=lambda s: s["size"])
        for span in spans:
            span_chars = [(c["c"], tuple(c["bbox"])) for c in span["chars"]]
            # 上标：字体标记为上标，或字号明显小于本行主字号且基线抬高（TeX 常见的脚注号、指数）
            is_sup = bool(span["flags"] & 1) or (
                span["size"] < 0.8 * main["size"] and span["origin"][1] < main["origin"][1] - 1.0
            )
            span_text = "".join(c for c, _ in span_chars).strip()
            if is_sup:
                at_block_start = not chars and not "".join(c for c, _ in line_chars).strip()
                if at_block_start and span_text.isdigit():
                    continue  # 脚注编号（块首的上标数字）不进句子
                prev = line_chars[-1][0] if line_chars else (chars[-1][0] if chars else "")
                if prev and prev.isalnum():
                    line_chars.append((" ", None))
                line_chars.extend(span_chars)
                space_after_sup = True
                continue
            if space_after_sup and span_chars[0][0].isalnum():
                line_chars.append((" ", None))
            space_after_sup = False
            line_chars.extend(span_chars)
        if not line_chars:
            continue
        if chars:
            last = _last_visible(chars)
            first = next((c for c, _ in line_chars if not c.isspace()), "")
            if (
                last is not None
                and chars[last][0] in "-\u00ad"
                and last > 0
                and chars[last - 1][0].isalpha()
                and first.islower()
            ):
                del chars[last:]  # 行末断词连字符：去掉连字符，直接接下一行
            else:
                chars.append((" ", None))
        chars.extend(line_chars)
    return _collapse_ws(chars)


def _last_visible(chars) -> int | None:
    for idx in range(len(chars) - 1, -1, -1):
        if not chars[idx][0].isspace():
            return idx
    return None


def _collapse_ws(chars):
    out: list[tuple[str, tuple | None]] = []
    for c, b in chars:
        if c.isspace() or c == "":
            if out and out[-1][0] != " ":
                out.append((" ", None))
            continue
        out.append((c, b))
    while out and out[-1][0] == " ":
        out.pop()
    return out


def _union(boxes) -> list[float] | None:
    boxes = [b for b in boxes if b is not None and b[2] > b[0] and b[3] > b[1]]
    if not boxes:
        return None
    return [
        round(min(b[0] for b in boxes), 1),
        round(min(b[1] for b in boxes), 1),
        round(max(b[2] for b in boxes), 1),
        round(max(b[3] for b in boxes), 1),
    ]


def _vertical_overlap(a, b) -> float:
    return max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def _merge_inline_blocks(blocks: list[dict]) -> list[dict]:
    """把与上一块最后一行同一行、位于其右半边的文字块并入上一块（行内公式常被拆成独立块）。"""
    out: list[dict] = []
    for block in blocks:
        if block.get("type") != 0 or not block.get("lines"):
            continue
        if out:
            prev_line = out[-1]["lines"][-1]
            first = block["lines"][0]
            pb, fb = prev_line["bbox"], first["bbox"]
            min_h = min(pb[3] - pb[1], fb[3] - fb[1])
            if (
                min_h > 0
                and _vertical_overlap(pb, fb) >= 0.5 * min_h
                and fb[0] >= pb[0] + 0.5 * (pb[2] - pb[0])
            ):
                merged_line = {
                    "bbox": (min(pb[0], fb[0]), min(pb[1], fb[1]), max(pb[2], fb[2]), max(pb[3], fb[3])),
                    "spans": list(prev_line["spans"]) + list(first["spans"]),
                }
                out[-1] = {**out[-1], "lines": out[-1]["lines"][:-1] + [merged_line] + block["lines"][1:]}
                continue
        out.append({"type": 0, "lines": list(block["lines"])})
    return out


def page_sentences(page: pymupdf.Page, page_no: int) -> list[Seg]:
    segs: list[Seg] = []
    counter = 0
    data = page.get_text("rawdict", flags=_FLAGS)
    for block in _merge_inline_blocks(data["blocks"]):
        chars = _block_chars(block)
        if not chars:
            continue
        text = "".join(c for c, _ in chars)
        for s, e in split_sentences(text):
            bbox = _union(b for _, b in chars[s:e])
            if bbox is None:
                continue
            counter += 1
            sid = f"s{page_no}_{counter}"
            segs.append(Seg("sentence", text[s:e], {"page": page_no, "sentence_ids": [sid], "bbox": bbox}))
    return segs


def parse_pdf(path, progress: ProgressFn = noop_progress) -> ParseResult:
    doc = _open(path)
    try:
        n = doc.page_count
        segs: list[Seg] = []
        landscape = 0
        text_pages = 0
        for pno in range(n):
            page = doc[pno]
            if page.rect.width > page.rect.height:
                landscape += 1
            page_segs = page_sentences(page, pno + 1)
            if sum(len(s.text) for s in page_segs) >= _MIN_TEXT_CHARS_PER_PAGE:
                text_pages += 1
            segs.extend(page_segs)
            progress((pno + 1) / n)
        if text_pages == 0:
            raise ParseFailed(NO_TEXT_MSG)
        title = (doc.metadata or {}).get("title", "").strip() or None
        if title and (title.lower().endswith((".pdf", ".dvi", ".doc", ".docx", ".tex")) or title.lower() == "untitled"):
            title = None
        return ParseResult(
            segments=segs,
            pages=n,
            group="slides" if landscape * 2 > n else "paper",
            title=title,
        )
    finally:
        doc.close()
