#!/usr/bin/env python3
"""用 PyMuPDF 实测示例论文里证据句的 bbox，写进 fixtures 源（src/mocks/fixtures-source.ts）前先跑本脚本核对。

坐标约定（docs/contract/evidence-locator.md）：PDF 坐标系 [x0, y0, x1, y1]，原点在页面左上角，单位 pt，
即 PyMuPDF 的默认页面坐标（未旋转页）。本论文 MediaBox = CropBox = [0 0 612 792]，页面无旋转。

做法：取页面逐词坐标（page.get_text("words")），按“首词序列 … 末词序列”在阅读顺序里定位证据句，
把命中词的外接矩形求并，四舍五入到 0.1 pt。

用法：python3 web/scripts/measure-bbox.py web/public/samples/attention-is-all-you-need.pdf
"""
import json
import sys

import fitz  # PyMuPDF

# 每条证据：页码（从 1 开始）、起始几个词、结尾几个词（按 PDF 文本层的分词，下标字母会被拆成单独的词）
TARGETS = {
    "evd_att_p4_fn4": {
        "page": 4,
        "start": ["To", "illustrate", "why", "the", "dot", "products", "get", "large,"],
        "end": ["has", "mean", "0", "and", "variance"],
        "end_extra": 1,  # “variance d_k.” 的 d、k. 两个词（下标拆开）
    },
    "evd_att_p5_heads": {
        "page": 5,
        "start": ["In", "this", "work", "we", "employ", "h", "=", "8"],
        "end": ["=", "64."],
        "end_extra": 0,
    },
}


def norm(w: str) -> str:
    # 脚注首词带上标“4”：“4To”
    return w.lstrip("0123456789") if w[:1].isdigit() and w[1:2].isalpha() else w


def find_seq(words, seq, start_at=0):
    texts = [norm(w[4]) for w in words]
    for i in range(start_at, len(texts) - len(seq) + 1):
        if texts[i : i + len(seq)] == seq:
            return i
    return -1


def measure(doc, spec):
    page = doc[spec["page"] - 1]
    words = page.get_text("words", sort=True)
    i = find_seq(words, spec["start"])
    if i < 0:
        raise SystemExit(f"第 {spec['page']} 页找不到起始词 {spec['start']}")
    j = find_seq(words, spec["end"], i)
    if j < 0:
        raise SystemExit(f"第 {spec['page']} 页找不到结尾词 {spec['end']}")
    last = j + len(spec["end"]) - 1 + spec["end_extra"]
    picked = words[i : last + 1]
    rect = fitz.Rect(picked[0][:4])
    for w in picked[1:]:
        rect |= fitz.Rect(w[:4])
    lines = sorted({(w[5], w[6]) for w in picked})
    return {
        "page": spec["page"],
        "bbox": [round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1)],
        "lines": len(lines),
        "first_word": picked[0][4],
        "last_word": picked[-1][4],
        "text": " ".join(w[4] for w in picked),
        "page_size": [page.rect.width, page.rect.height],
        "mediabox": list(page.mediabox),
        "cropbox": list(page.cropbox),
        "rotation": page.rotation,
    }


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "web/public/samples/attention-is-all-you-need.pdf"
    doc = fitz.open(path)
    out = {"file": path, "pages": doc.page_count, "pymupdf": fitz.VersionBind, "evidence": {}}
    for eid, spec in TARGETS.items():
        out["evidence"][eid] = measure(doc, spec)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
