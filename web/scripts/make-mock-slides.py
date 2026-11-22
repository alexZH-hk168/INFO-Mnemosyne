#!/usr/bin/env python3
"""生成两份“模拟课件”PDF，给右栏 PPT 预览与横版 PDF 课件做演示数据（R4：演示数据只在 mocks / public/samples）。

- l05-attention-slides.mock.pdf：模拟 `L05 注意力机制.pptx` 由后端转换后的 PDF（契约：PPTX 的 raw 返回转换后的 PDF），32 页，
  第 18 页正文是 fixture 证据 evd_l05_s18 的 quote。
- l04-backprop-slides.mock.pdf：模拟横版 PDF 课件 `L04 反向传播.pdf`，28 页。

页面 16:9（960 × 540 pt），每页角落标注“模拟课件，非真实课程材料”。字体嵌入 Noto Sans SC 子集（SIL OFL 1.1，
先用 fontTools 按用到的字符裁剪再嵌入；PyMuPDF 自带的 subset_fonts 处理不了这份 CFF 字体）。

用法：python3 web/scripts/make-mock-slides.py   （输出到 web/public/samples/）
"""
import tempfile
from pathlib import Path

import fitz  # PyMuPDF
from fontTools import subset as ftsubset

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "samples"
FONT = "/usr/local/share/fonts/lightread-writing/Noto Sans SC/NotoSansSC-Regular.otf"
W, H = 960, 540

L05_TITLES = {
    1: "L05 注意力机制",
    2: "本讲内容",
    17: "缩放点积注意力",
    18: "为什么要除以 √dk",
    19: "多头注意力",
}
L05_BODY = {
    18: [
        "softmax 饱和：输入差距过大时输出接近 one-hot，梯度几乎为 0",
        "点积 q·k 的方差随 dk 线性增长",
        "除以 √dk 把方差拉回 1",
    ],
}
L04_TITLES = {1: "L04 反向传播", 2: "本讲内容", 12: "链式法则", 20: "sigmoid 的梯度"}


NOTE = "模拟课件，非真实课程材料（Mnemosyne 演示数据）"


def texts(deck: str, pages: int, titles: dict, bodies: dict) -> list[str]:
    out = [NOTE]
    for n in range(1, pages + 1):
        out.append(titles.get(n, f"{deck} · 第 {n} 页"))
        out.append(f"{n} / {pages}")
        out.extend("• " + line for line in bodies.get(n, []))
    return out


def subset_font(chars: str) -> str:
    out = tempfile.NamedTemporaryFile(suffix=".otf", delete=False).name
    opts = ftsubset.Options()
    opts.name_IDs = ["*"]
    font = ftsubset.load_font(FONT, opts)
    sub = ftsubset.Subsetter(opts)
    sub.populate(text=chars)
    sub.subset(font)
    ftsubset.save_font(font, out, opts)
    return out


def make(path: Path, deck: str, pages: int, titles: dict, bodies: dict) -> None:
    fontfile = subset_font("".join(sorted(set("".join(texts(deck, pages, titles, bodies))))))
    doc = fitz.open()
    for n in range(1, pages + 1):
        page = doc.new_page(width=W, height=H)
        page.insert_font(fontname="noto", fontfile=fontfile)
        page.draw_rect(fitz.Rect(0, 0, W, 6), color=None, fill=(0.80, 0.42, 0.18))
        title = titles.get(n, f"{deck} · 第 {n} 页")
        page.insert_text((64, 120), title, fontname="noto", fontsize=34, color=(0.15, 0.14, 0.12))
        y = 200
        for line in bodies.get(n, []):
            page.insert_text((84, y), "• " + line, fontname="noto", fontsize=22, color=(0.25, 0.24, 0.22))
            y += 48
        page.insert_text((64, H - 32), NOTE, fontname="noto", fontsize=11, color=(0.55, 0.53, 0.5))
        page.insert_text((W - 90, H - 32), f"{n} / {pages}", fontname="noto", fontsize=11, color=(0.55, 0.53, 0.5))
    doc.set_metadata({"title": f"{deck}（模拟课件）", "creator": "Mnemosyne web/scripts/make-mock-slides.py"})
    doc.save(path, garbage=4, deflate=True)
    print(f"{path.name}: {pages} 页, {path.stat().st_size} 字节")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make(OUT / "l05-attention-slides.mock.pdf", "L05 注意力机制", 32, L05_TITLES, L05_BODY)
    make(OUT / "l04-backprop-slides.mock.pdf", "L04 反向传播", 28, L04_TITLES, {})


if __name__ == "__main__":
    main()
