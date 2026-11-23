"""评测脚本共用的小工具：JSONL 读写、sha256、config_hash、文本归一化、拒答判断。

只用标准库；不 import app/（评测脚本与系统代码分开，见立项稿图 8）。
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import unicodedata
from pathlib import Path
from typing import Any, Iterable, Iterator

SEED = 20261121

# 消融与系统代号（立项稿 11.2）。
LME_SYSTEMS = ("B1", "B2", "M", "A1", "A2", "A4")  # LongMemEval_S 运行矩阵（scripts.md）
BRANCHMEM_SYSTEMS = ("B2", "M", "A3")  # BranchMem 运行矩阵（scripts.md）
ALL_SYSTEMS = ("B1", "B2", "M", "A1", "A2", "A3", "A4")


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:  # 报出行号，方便定位坏行
                raise ValueError(f"{path}:{ln} 不是合法 JSON：{e}") from e
    return out


def iter_jsonl(path: str | Path) -> Iterator[dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def write_jsonl(path: str | Path, rows: Iterable[dict[str, Any]]) -> int:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=False) + "\n")
            n += 1
    tmp.replace(path)
    return n


def append_jsonl(path: str | Path, row: dict[str, Any]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def file_sha256(path: str | Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def config_hash(config: dict[str, Any]) -> str:
    """配置的稳定哈希：键排序后的紧凑 JSON 取 sha256 前 16 位。"""
    return hashlib.sha256(canonical_json(config).encode("utf-8")).hexdigest()[:16]


def stable_int(text: str) -> int:
    return int.from_bytes(hashlib.blake2b(text.encode("utf-8"), digest_size=8).digest(), "big")


_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+")


def normalize_text(text: Any) -> str:
    """小写、去标点、合并空白；用于 distractor 命中判定与假判分器。"""
    s = unicodedata.normalize("NFKC", str(text)).lower()
    s = _PUNCT_RE.sub(" ", s)
    return _WS_RE.sub(" ", s).strip()


def contains_phrase(haystack: Any, needle: Any) -> bool:
    """按词边界判断 needle 是否出现在 haystack 中（都先归一化）。空 needle 返回 False。"""
    n = normalize_text(needle)
    if not n:
        return False
    return f" {n} " in f" {normalize_text(haystack)} "


# 回答层面的拒答识别（只作 predictions.abstained 的记录；拒答正确率以判分器结果为准，与官方一致）。
_ABSTAIN_RE = re.compile(
    r"(i don'?t know|i do not know|not (been )?mentioned|no (relevant )?information|"
    r"(cannot|can'?t|unable to) (find|determine|answer|tell)|not enough information|"
    r"you (haven'?t|have not|never) (told|mentioned|said)|there is no record|"
    r"无法(回答|确定)|没有(提到|相关信息|记录)|不知道)",
    re.IGNORECASE,
)


def looks_like_abstention(text: str) -> bool:
    return bool(_ABSTAIN_RE.search(text or ""))


def ensure_free_space(path: str | Path, need_bytes: int) -> None:
    """写大文件前检查剩余空间；不够就抛 OSError（errno 28 语义），调用方应停下。"""
    p = Path(path)
    probe = p if p.exists() else p.parent
    while not probe.exists():
        probe = probe.parent
    free = shutil.disk_usage(probe).free
    if free < need_bytes:
        raise OSError(28, f"磁盘空间不足：需要约 {need_bytes / 1e6:.0f} MB，{probe} 只剩 {free / 1e6:.0f} MB")
