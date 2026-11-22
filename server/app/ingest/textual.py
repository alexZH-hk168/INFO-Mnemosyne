"""代码、Notebook、Markdown 解析。

- 代码：Python 用 ast 按顶层函数/类（大类再拆方法）切段；其他语言按常见定义行（function/class/def/fn/func…）
  切段；都切不出时按 60 行一窗。locator `{path, lines: [start, end]}`，行号从 1 开始、闭区间。
- Notebook：每个 markdown/code 单元格一段，输出（outputs）不入检索；locator `{path, cell, lines}`，
  cell 从 0 开始（按 .ipynb 里的单元格顺序计），lines 为单元格内行号。
- Markdown：按标题与空行分块，围栏代码块整体保留；locator `{path, lines}`。
超过 80 行的段落再按 60 行一窗切开。
"""

from __future__ import annotations

import ast
import json
import re

from app.ingest.types import ParseFailed, ParseResult, ProgressFn, Seg, noop_progress, window_lines

CODE_EXTENSIONS = {
    ".py", ".pyi", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".java", ".kt", ".kts", ".scala",
    ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".cs", ".go", ".rs", ".rb", ".php", ".swift",
    ".m", ".mm", ".r", ".jl", ".lua", ".sh", ".bash", ".zsh", ".sql", ".pl", ".hs", ".ex", ".exs",
    ".dart", ".vue", ".svelte", ".css", ".scss", ".html", ".htm", ".json", ".yaml", ".yml", ".toml",
    ".ini", ".cfg", ".tex", ".cu", ".f90", ".proto", ".gradle", ".cmake",
}
MAX_SEG_LINES = 80
WINDOW = 60

_DEF_RE = re.compile(
    r"""^\s*(?:
        (?:export\s+)?(?:default\s+)?(?:async\s+)?function\b
      | (?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\b
      | (?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>
      | (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\b
      | func\b
      | def\b
      | (?:public|private|protected|internal|static|final|override|virtual|abstract|\s)+[\w<>\[\],.?\s]+\s+\w+\s*\([^;]*$
      | (?:struct|enum|interface|trait|impl|module|namespace|type)\s+\w+
    )""",
    re.VERBOSE,
)


def decode_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    try:
        return raw.decode("gb18030")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace")


def read_text(path) -> str:
    with open(path, "rb") as f:
        return decode_text(f.read())


def _line_segs(lines: list[str], ranges: list[tuple[int, int]], path: str) -> list[Seg]:
    segs: list[Seg] = []
    for s, e in ranges:
        # 去掉首尾空行
        while s <= e and not lines[s - 1].strip():
            s += 1
        while e >= s and not lines[e - 1].strip():
            e -= 1
        if s > e:
            continue
        parts = window_lines(s, e, WINDOW) if e - s + 1 > MAX_SEG_LINES else [(s, e)]
        for ps, pe in parts:
            text = "\n".join(lines[ps - 1 : pe])
            if text.strip():
                segs.append(Seg("line", text, {"path": path, "lines": [ps, pe]}))
    return segs


def _fill_gaps(ranges: list[tuple[int, int]], total: int) -> list[tuple[int, int]]:
    """补上定义之间、之前、之后的代码，返回覆盖 1..total 的有序区间。"""
    ranges = sorted(ranges)
    out: list[tuple[int, int]] = []
    cur = 1
    for s, e in ranges:
        if s > cur:
            out.append((cur, s - 1))
        if e >= s and e >= cur:
            out.append((max(s, cur), e))
            cur = e + 1
    if cur <= total:
        out.append((cur, total))
    return out


def _python_ranges(text: str, total: int) -> list[tuple[int, int]] | None:
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return None
    ranges: list[tuple[int, int]] = []

    def start_of(node) -> int:
        decos = [d.lineno for d in getattr(node, "decorator_list", [])]
        return min([node.lineno, *decos])

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            ranges.append((start_of(node), node.end_lineno))
        elif isinstance(node, ast.ClassDef):
            s, e = start_of(node), node.end_lineno
            methods = [n for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
            if e - s + 1 <= MAX_SEG_LINES or not methods:
                ranges.append((s, e))
            else:
                inner = [(start_of(m), m.end_lineno) for m in methods]
                # 类头部（class 行到第一个方法之前）＋各方法＋方法之间的类体
                cur = s
                for ms, me in inner:
                    if ms > cur:
                        ranges.append((cur, ms - 1))
                    ranges.append((ms, me))
                    cur = me + 1
                if cur <= e:
                    ranges.append((cur, e))
    return _fill_gaps(ranges, total)


def _generic_ranges(lines: list[str]) -> list[tuple[int, int]]:
    starts = [i + 1 for i, line in enumerate(lines) if _DEF_RE.match(line) and not line.lstrip().startswith(("//", "#", "*"))]
    if not starts:
        return [(1, len(lines))]
    bounds = sorted(set([1, *starts]))
    out = []
    for idx, s in enumerate(bounds):
        e = bounds[idx + 1] - 1 if idx + 1 < len(bounds) else len(lines)
        out.append((s, e))
    return out


def parse_code(path, display_path: str, progress: ProgressFn = noop_progress) -> ParseResult:
    text = read_text(path)
    lines = text.splitlines()
    if not lines:
        raise ParseFailed("文件为空")
    ranges = None
    if display_path.lower().endswith((".py", ".pyi")):
        ranges = _python_ranges(text, len(lines))
    if ranges is None:
        ranges = _generic_ranges(lines)
    segs = _line_segs(lines, ranges, display_path)
    progress(1.0)
    if not segs:
        raise ParseFailed("文件没有可检索的文字")
    return ParseResult(segments=segs, group="code", extra={"lines": len(lines)})


def parse_notebook(path, display_path: str, progress: ProgressFn = noop_progress) -> ParseResult:
    try:
        nb = json.loads(read_text(path))
        cells = nb["cells"]
        if not isinstance(cells, list):
            raise TypeError
    except (ValueError, KeyError, TypeError) as e:
        raise ParseFailed("Notebook 格式无效：不是 nbformat 4 的 JSON") from e
    segs: list[Seg] = []
    for idx, cell in enumerate(cells):
        if cell.get("cell_type") not in ("code", "markdown", "raw"):
            continue
        src = cell.get("source", "")
        text = "".join(src) if isinstance(src, list) else str(src)
        lines = text.splitlines()
        if not text.strip():
            continue
        n = len(lines)
        parts = window_lines(1, n, WINDOW) if n > MAX_SEG_LINES else [(1, n)]
        for s, e in parts:
            chunk = "\n".join(lines[s - 1 : e])
            if chunk.strip():
                segs.append(Seg("cell", chunk, {"path": display_path, "cell": idx, "lines": [s, e]}))
        progress((idx + 1) / max(1, len(cells)))
    if not segs:
        raise ParseFailed("Notebook 没有可检索的单元格")
    return ParseResult(segments=segs, cells=len(cells), group="code")


def parse_markdown(path, display_path: str, progress: ProgressFn = noop_progress) -> ParseResult:
    text = read_text(path)
    lines = text.splitlines()
    if not lines:
        raise ParseFailed("文件为空")
    ranges: list[tuple[int, int]] = []
    start: int | None = None
    fence_start: int | None = None
    for i, line in enumerate(lines, start=1):
        stripped = line.strip()
        is_fence = stripped.startswith(("```", "~~~"))
        if fence_start is not None:
            if is_fence:
                ranges.append((fence_start, i))
                fence_start = None
            continue
        if is_fence:
            if start is not None:
                ranges.append((start, i - 1))
                start = None
            fence_start = i
            continue
        if stripped.startswith("#"):
            if start is not None:
                ranges.append((start, i - 1))
            start = i
            continue
        if not stripped:
            # 标题后紧跟的空行不切断：标题与下一段合为一段
            if start is not None and not (start == i - 1 and lines[start - 1].lstrip().startswith("#")):
                ranges.append((start, i - 1))
                start = None
            continue
        if start is None:
            start = i
    if fence_start is not None:
        ranges.append((fence_start, len(lines)))
    elif start is not None:
        ranges.append((start, len(lines)))
    segs = _line_segs(lines, ranges, display_path)
    progress(1.0)
    if not segs:
        raise ParseFailed("文件没有可检索的文字")
    return ParseResult(segments=segs, group="notes", extra={"lines": len(lines)})
