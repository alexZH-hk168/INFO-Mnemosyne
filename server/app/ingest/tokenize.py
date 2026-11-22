"""分词：token 计数（分块用）与 FTS5 预分词（检索用）。

- count_tokens：近似 token 数＝拉丁词/数字串个数 + 中日韩单字个数 + 标点个数。不依赖需要联网下载词表的分词器。
- fts_tokens：NFKC 规整、小写；拉丁词整词；中日文连续串切成相邻二元组（单字串保留单字）。
  建索引和查询用同一函数，保证 BM25 两边口径一致。
"""

from __future__ import annotations

import re
import unicodedata

_CJK = "\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af"
_COUNT_RE = re.compile(rf"[{_CJK}]|[^\W_{_CJK}]+|[^\w\s]", re.UNICODE)
_FTS_RE = re.compile(rf"[{_CJK}]+|[^\W_{_CJK}]+", re.UNICODE)


def count_tokens(text: str) -> int:
    return len(_COUNT_RE.findall(text))


def fts_tokens(text: str) -> list[str]:
    norm = unicodedata.normalize("NFKC", text).lower()
    out: list[str] = []
    for m in _FTS_RE.finditer(norm):
        tok = m.group(0)
        if re.match(rf"[{_CJK}]", tok):
            if len(tok) == 1:
                out.append(tok)
            else:
                out.extend(tok[i : i + 2] for i in range(len(tok) - 1))
        else:
            out.append(tok)
    return out


def fts_body(text: str) -> str:
    return " ".join(fts_tokens(text))


def fts_query(text: str) -> str | None:
    """把自然语言查询转成 FTS5 MATCH 表达式（各词 OR），无可用词时返回 None。"""
    seen: list[str] = []
    for tok in fts_tokens(text):
        if tok not in seen:
            seen.append(tok)
    if not seen:
        return None
    return " OR ".join('"' + t.replace('"', '""') + '"' for t in seen)
