"""回答正文的文本工具：去掉 [[E#]] 标记、切句、字符二元组重叠率。

偏移一律按 Unicode 码点、左闭右开（契约 README 第 7 条），Python 字符串下标本身就是码点。
"""

from __future__ import annotations

import re

MARKER_RE = re.compile(r"\[\[(E\d+)\]\]")
_SENT_END = set("。！？!?")
_CLOSERS = set("”’」』）)】》\"'")


def strip_markers(raw: str) -> tuple[str, list[tuple[str, int]]]:
    """返回 (去标记纯文本, [(label, 标记在纯文本中的位置)])。"""
    out: list[str] = []
    marks: list[tuple[str, int]] = []
    pos = 0
    plain_len = 0
    for m in MARKER_RE.finditer(raw):
        seg = raw[pos : m.start()]
        out.append(seg)
        plain_len += len(seg)
        marks.append((m.group(1), plain_len))
        pos = m.end()
    out.append(raw[pos:])
    return "".join(out), marks


def split_sentences(text: str) -> list[tuple[int, int]]:
    """切句：句末标点（含其后的右引号/括号）、英文句点后接空白、换行都算句子边界；首尾空白不计入句子。"""
    spans: list[tuple[int, int]] = []
    n = len(text)
    start = None
    i = 0
    while i < n:
        ch = text[i]
        if start is None:
            if not ch.isspace():
                start = i
            else:
                i += 1
                continue
        if ch == "\n":
            spans.append((start, i))
            start = None
            i += 1
            continue
        end_here = ch in _SENT_END or (ch == "." and (i + 1 == n or text[i + 1].isspace()))
        if end_here:
            j = i + 1
            while j < n and (text[j] in _CLOSERS or text[j] in _SENT_END):
                j += 1
            spans.append((start, j))
            start = None
            i = j
            continue
        i += 1
    if start is not None:
        spans.append((start, n))
    out = []
    for s, e in spans:
        while e > s and text[e - 1].isspace():
            e -= 1
        if e > s:
            out.append((s, e))
    return out


def sentence_for_position(spans: list[tuple[int, int]], pos: int) -> tuple[int, int] | None:
    """标记位置 pos 属于哪一句：取标记前一个字符所在的句子（标记写在句号前后都归到这句）。"""
    if not spans:
        return None
    probe = max(pos - 1, 0)
    for s, e in spans:
        if s <= probe < e:
            return (s, e)
    # 标记前是空白：归到它之前最近的一句
    prev = [sp for sp in spans if sp[1] <= pos]
    return prev[-1] if prev else spans[0]


def _norm(s: str) -> str:
    return "".join(s.lower().split())


def bigrams(s: str) -> set[str]:
    t = _norm(s)
    if len(t) < 2:
        return {t} if t else set()
    return {t[i : i + 2] for i in range(len(t) - 1)}


def overlap(sentence: str, quote: str) -> float:
    """回答句的字符二元组中出现在 quote 里的比例（以回答句为分母）。"""
    a = bigrams(sentence)
    if not a:
        return 0.0
    return len(a & bigrams(quote)) / len(a)


def cjk_ratio(s: str) -> float:
    t = _norm(s)
    if not t:
        return 0.0
    cjk = sum(1 for ch in t if "\u3400" <= ch <= "\u9fff" or "\uf900" <= ch <= "\ufaff")
    return cjk / len(t)


def cross_language(sentence: str, quote: str) -> bool:
    """回答句与证据一中一外（一方中日韩汉字占比 ≥ 30%，另一方 < 10%）：字符二元组无法衡量（U71）。"""
    a, b = cjk_ratio(sentence), cjk_ratio(quote)
    return (a >= 0.3 and b < 0.1) or (b >= 0.3 and a < 0.1)
