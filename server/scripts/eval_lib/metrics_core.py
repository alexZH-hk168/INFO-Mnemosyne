"""指标计算（metrics.py 的核心，单独成模块便于单测手算核对）。

口径（立项稿 11.3 + 官方代码，未决 U101 待用户确认）：
- qa_acc：判分 correct 的均值；分题型时拒答题计入其原题型（与官方 print_qa_metrics.py 相同）。
- recall@k_session / recall@k_turn：官方主报的 recall_all@k，即前 k 个检索结果覆盖了全部证据才算 1，否则 0，再对题取均值。
  session 级：retrieved_ids 按顺序去重后取前 k 个 session，证据 = answer_session_ids（BranchMem 为 gold_path_session_ids）；
  turn 级：retrieved_ids 前 k 条，证据 = has_answer 轮（user 与 assistant 都算，官方检索代码只索引 user 轮，这里 B2 按轮切块含两种角色）。
  拒答题与没有证据的题不计入（官方同样跳过拒答题）。B1 不检索，记 null。
- cited_turn_hit_rate：被引用轮次中 has_answer 为真的比例（全部被引轮次合在一起算，经 msg_map 映射回原始轮次；不含拒答题）。
  A2 不要求引用、B1 不引用，记 null（scripts.md：A2 记为不适用）。
- abstention_acc：拒答题（question_id 以 _abs 结尾）上 correct 的均值，分母为该组全部拒答题。
- branch_acc：BranchMem 上 correct 的均值；leak_rate：回答含兄弟分支的 distractor_value（按词边界、归一化后匹配），
  或引用了兄弟分支消息（经 msg_map 映射到 distractor_branch_session_ids），任一即计泄漏（scripts.md）。
- tokens_per_q：tokens_in + tokens_out 的均值；latency_p50：latency_ms 的中位数。
"""

from __future__ import annotations

import statistics
from typing import Any, Iterable

from .common import contains_phrase
from .data import EvalItem

METRIC_FIELDS = (
    "qa_acc",
    "recall@k_session",
    "recall@k_turn",
    "cited_turn_hit_rate",
    "abstention_acc",
    "branch_acc",
    "leak_rate",
    "tokens_per_q",
    "latency_p50",
)
NO_RETRIEVAL_SYSTEMS = {"B1"}
NO_CITATION_SYSTEMS = {"B1", "A2"}


def session_recall_all(retrieved: list[dict[str, Any]], gold: Iterable[str], k: int) -> float | None:
    gold = set(gold)
    if not gold:
        return None
    seen: list[str] = []
    for r in retrieved:
        if r["session_id"] not in seen:
            seen.append(r["session_id"])
        if len(seen) >= k:
            break
    return 1.0 if gold <= set(seen[:k]) else 0.0


def turn_recall_all(retrieved: list[dict[str, Any]], gold: set[tuple[str, int]], k: int) -> float | None:
    if not gold:
        return None
    got = {(r["session_id"], r["turn_idx"]) for r in retrieved[:k]}
    return 1.0 if gold <= got else 0.0


def cited_hits(row: dict[str, Any], item: EvalItem, msg_map: dict[str, tuple[str, int]]) -> tuple[int, int]:
    """返回（命中证据轮的被引轮次数, 被引轮次数）。msg_map 里查不到的引用不计入分母，并在调用方计数报出。"""
    hit = tot = 0
    for mid in row["cited_message_ids"]:
        if mid not in msg_map:
            continue
        tot += 1
        if tuple(msg_map[mid]) in item.gold_turns:
            hit += 1
    return hit, tot


def is_leak(row: dict[str, Any], item: EvalItem, msg_map: dict[str, tuple[str, int]]) -> bool:
    if item.distractor_value and contains_phrase(row["hypothesis"], item.distractor_value):
        return True
    dsess = set(item.distractor_sessions)
    return any(mid in msg_map and msg_map[mid][0] in dsess for mid in row["cited_message_ids"])


def _mean(xs: list[float]) -> float | None:
    return round(sum(xs) / len(xs), 4) if xs else None


def aggregate(
    rows: list[dict[str, Any]],
    judged: dict[str, int],
    items: dict[str, EvalItem],
    msg_map: dict[str, tuple[str, int]],
    k: int,
) -> dict[str, Any]:
    """一个（系统, 题组）的全部指标。rows 都属于同一系统。"""
    if not rows:
        return {"n": 0, **{f: None for f in METRIC_FIELDS}}
    system = rows[0]["system"]
    its = [items[r["question_id"]] for r in rows]
    correct = [judged[r["question_id"]] for r in rows]
    kind = its[0].kind
    out: dict[str, Any] = {"n": len(rows)}
    out["qa_acc"] = _mean([float(c) for c in correct])
    if system in NO_RETRIEVAL_SYSTEMS:
        out["recall@k_session"] = out["recall@k_turn"] = None
    else:
        rs = [session_recall_all(r["retrieved_ids"], it.gold_sessions, k) for r, it in zip(rows, its) if not it.is_abstention]
        rt = [turn_recall_all(r["retrieved_ids"], it.gold_turns, k) for r, it in zip(rows, its) if not it.is_abstention]
        out["recall@k_session"] = _mean([x for x in rs if x is not None])
        out["recall@k_turn"] = _mean([x for x in rt if x is not None])
    if system in NO_CITATION_SYSTEMS:
        out["cited_turn_hit_rate"] = None
    else:
        h = t = 0
        for r, it in zip(rows, its):
            if it.is_abstention:
                continue
            a, b = cited_hits(r, it, msg_map)
            h += a
            t += b
        out["cited_turn_hit_rate"] = round(h / t, 4) if t else None
    ab = [float(c) for c, it in zip(correct, its) if it.is_abstention]
    out["abstention_acc"] = _mean(ab)
    if kind == "branchmem":
        out["branch_acc"] = out["qa_acc"]
        out["leak_rate"] = _mean([1.0 if is_leak(r, it, msg_map) else 0.0 for r, it in zip(rows, its)])
    else:
        out["branch_acc"] = out["leak_rate"] = None
    out["tokens_per_q"] = round(statistics.mean(r["tokens_in"] + r["tokens_out"] for r in rows), 1)
    out["latency_p50"] = statistics.median(r["latency_ms"] for r in rows)
    return out


def compute_table(
    preds: list[dict[str, Any]],
    judged: dict[str, int],
    items: dict[str, EvalItem],
    msg_map: dict[str, tuple[str, int]],
    k: int,
    dev_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """按（split, system, question_type）展开：split ∈ full、heldout（给了 dev_ids 且是 LongMemEval 时），
    question_type 含 ALL。"""
    missing = [p["question_id"] for p in preds if p["question_id"] not in judged]
    if missing:
        raise ValueError(f"{len(missing)} 题没有判分结果，例如 {missing[:3]}")
    unknown = [p["question_id"] for p in preds if p["question_id"] not in items]
    if unknown:
        raise ValueError(f"{len(unknown)} 题不在 --data 里，例如 {unknown[:3]}")
    splits: list[tuple[str, list[dict[str, Any]]]] = [("full", preds)]
    if dev_ids is not None and preds and items[preds[0]["question_id"]].kind == "lme":
        splits.append(("heldout", [p for p in preds if p["question_id"] not in dev_ids]))
    table = []
    for split, rows in splits:
        systems = sorted({r["system"] for r in rows})
        for s in systems:
            srows = [r for r in rows if r["system"] == s]
            groups = ["ALL"] + sorted({r["question_type"] for r in srows})
            for g in groups:
                grows = srows if g == "ALL" else [r for r in srows if r["question_type"] == g]
                table.append({"split": split, "system": s, "question_type": g, **aggregate(grows, judged, items, msg_map, k)})
    return table
