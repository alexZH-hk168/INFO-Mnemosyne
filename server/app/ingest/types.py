"""解析器共用的数据结构与错误。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


class ParseFailed(Exception):
    """可读的解析失败原因，直接写入 documents.parse_error，并对应错误码 PARSE_FAILED。"""


@dataclass
class Seg:
    kind: str  # sentence | line | cell | shape
    text: str
    locator: dict


@dataclass
class ParseResult:
    segments: list[Seg]
    pages: int | None = None
    cells: int | None = None
    group: str | None = None  # 解析器可改写分组（横版 PDF → slides）
    title: str | None = None  # PDF 元数据标题
    extra: dict = field(default_factory=dict)


ProgressFn = Callable[[float], None]  # 0.0–1.0


def noop_progress(_: float) -> None:
    return None


def window_lines(start: int, end: int, size: int = 60) -> list[tuple[int, int]]:
    """把闭区间 [start, end] 切成每段至多 size 行的若干闭区间。"""
    out = []
    s = start
    while s <= end:
        e = min(end, s + size - 1)
        out.append((s, e))
        s = e + 1
    return out
