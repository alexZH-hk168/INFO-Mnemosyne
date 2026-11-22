"""分块：按片段顺序累加，单块 token 数不超过 500；累计达到 300 后遇到“自然边界”优先切。

自然边界：PDF 换页、代码/Markdown/Notebook 的每个片段本身就是函数/段落/单元格，所以除了 token 上限外不额外切。
单个片段超过 500 token 时（长表格、超长函数）按词切成多个块，这些块记录同一个 segment_id。
"""

from __future__ import annotations

from dataclasses import dataclass

from app.ingest.tokenize import _COUNT_RE, count_tokens

MIN_TOKENS = 300
MAX_TOKENS = 500


@dataclass
class ChunkDraft:
    text: str
    segment_ids: list[str]
    token_count: int


def _split_long(text: str, max_tokens: int) -> list[str]:
    pieces: list[str] = []
    matches = list(_COUNT_RE.finditer(text))
    for i in range(0, len(matches), max_tokens):
        group = matches[i : i + max_tokens]
        start = group[0].start()
        end = matches[i + max_tokens].start() if i + max_tokens < len(matches) else len(text)
        pieces.append(text[start:end].strip())
    return [p for p in pieces if p]


def build_chunks(segments: list[tuple[str, str, dict]], min_tokens: int = MIN_TOKENS, max_tokens: int = MAX_TOKENS) -> list[ChunkDraft]:
    """segments: [(segment_id, text, locator)]，按 order_idx 排好序。"""
    chunks: list[ChunkDraft] = []
    cur_ids: list[str] = []
    cur_texts: list[str] = []
    cur_tokens = 0
    cur_page = None

    def flush():
        nonlocal cur_ids, cur_texts, cur_tokens
        if cur_ids:
            chunks.append(ChunkDraft("\n".join(cur_texts), list(cur_ids), cur_tokens))
        cur_ids, cur_texts, cur_tokens = [], [], 0

    for seg_id, text, locator in segments:
        n = count_tokens(text)
        page = locator.get("page", locator.get("slide"))
        if n > max_tokens:
            flush()
            for piece in _split_long(text, max_tokens):
                chunks.append(ChunkDraft(piece, [seg_id], count_tokens(piece)))
            cur_page = page
            continue
        if cur_ids and cur_tokens + n > max_tokens:
            flush()
        elif cur_ids and cur_tokens >= min_tokens and page is not None and page != cur_page:
            flush()  # 已够 300 token 且换页，在页边界切
        cur_ids.append(seg_id)
        cur_texts.append(text)
        cur_tokens += n
        cur_page = page
    flush()
    return chunks
