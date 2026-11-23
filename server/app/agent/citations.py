"""引用校验三关（evidence-locator.md“引用校验三关”）。

1. 存在性：E# 必须在本轮证据池，否则 removed（eid 为空串，U72）。
2. 词面重叠：回答句的字符二元组出现在 quote 里的比例，< 0.05 直接 removed；其余记入 citations.overlap。
   回答句与证据一中一外时字符二元组无法衡量，第二关不剔除、交给第三关（U71）。
3. 支持度：小模型一次判完本回答的全部剩余引用（supported / partial / removed）；判定失败时一律 partial（保守，前端标“推断”）。
句子区间相对去掉 [[E#]] 后的正文，左闭右开、按码点（契约 README 第 7 条）。同一句里同一个 E# 只算一条引用。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.agent.text import cross_language, overlap, sentence_for_position, split_sentences, strip_markers
from app.llm.base import ChatModel, ModelError
from app.llm.fake import JUDGE_TAG

OVERLAP_MIN = 0.05
VERDICTS = ("supported", "partial", "removed")


@dataclass
class PoolItem:
    eid: str
    label: str
    quote: str


@dataclass
class Check:
    label: str
    eid: str
    start: int
    end: int
    sentence: str
    quote: str
    overlap: float | None = None
    verdict: str | None = None


def collect(raw: str, pool: dict[str, PoolItem]) -> list[Check]:
    """找出正文里的全部引用（按出现顺序），并完成第一关。"""
    plain, marks = strip_markers(raw)
    spans = split_sentences(plain)
    out: list[Check] = []
    seen: set[tuple[str, int, int]] = set()
    for label, pos in marks:
        span = sentence_for_position(spans, pos) or (0, len(plain))
        key = (label, span[0], span[1])
        if key in seen:
            continue
        seen.add(key)
        item = pool.get(label)
        c = Check(label, item.eid if item else "", span[0], span[1], plain[span[0] : span[1]], item.quote if item else "")
        if item is None:
            c.verdict = "removed"
        out.append(c)
    return out


def gate_overlap(checks: list[Check]) -> None:
    for c in checks:
        if c.verdict is not None:
            continue
        c.overlap = round(overlap(c.sentence, c.quote), 4)
        if c.overlap < OVERLAP_MIN and not cross_language(c.sentence, c.quote):
            c.verdict = "removed"


def judge_prompt(items: list[dict]) -> list[dict]:
    return [
        {"role": "system", "content": "你是引用核查员，只根据给出的证据原文判断回答句是否有依据，不使用自己的知识。"},
        {
            "role": "user",
            "content": (
                f"{JUDGE_TAG}\n逐条判断“回答句”是否被对应“证据”支持："
                "supported＝证据完整支持这句话；partial＝证据只支持一部分，或需要额外推断；removed＝证据不支持这句话。\n"
                '只输出一个 JSON 数组，形如 [{"i": 0, "verdict": "supported"}]，不要其他文字。\n'
                f"```json\n{json.dumps(items, ensure_ascii=False)}\n```"
            ),
        },
    ]


def parse_verdicts(text: str) -> dict[int, str]:
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return {}
    out: dict[int, str] = {}
    for it in data if isinstance(data, list) else []:
        if isinstance(it, dict) and it.get("verdict") in VERDICTS and isinstance(it.get("i"), int):
            out[it["i"]] = it["verdict"]
    return out


async def gate_judge(checks: list[Check], model: ChatModel, small_model: str) -> tuple[int, int]:
    """第三关。返回这次调用的 usage。"""
    todo = [c for c in checks if c.verdict is None]
    if not todo:
        return (0, 0)
    items = [{"i": i, "sentence": c.sentence, "quote": c.quote[:1500]} for i, c in enumerate(todo)]
    usage = (0, 0)
    verdicts: dict[int, str] = {}
    try:
        text, usage = await model.complete(judge_prompt(items), model=small_model)
        verdicts = parse_verdicts(text)
    except ModelError:
        verdicts = {}
    for i, c in enumerate(todo):
        c.verdict = verdicts.get(i, "partial")
    return usage


async def verify(raw: str, pool: dict[str, PoolItem], model: ChatModel, small_model: str) -> tuple[list[Check], tuple[int, int]]:
    checks = collect(raw, pool)
    gate_overlap(checks)
    usage = await gate_judge(checks, model, small_model)
    return checks, usage


def unverified(raw: str, pool: dict[str, PoolItem]) -> list[Check]:
    """取消时：不做第二、三关，池里有的引用一律 partial（sse-events.md“取消”）。"""
    checks = collect(raw, pool)
    for c in checks:
        if c.verdict is None:
            c.verdict = "partial"
    return checks
