"""三类待测系统的单题运行：B1（全量上下文）、B2（朴素 RAG，按轮切块、要求引用检索到的轮次）、M/A1–A4（后端适配器）。

每题产出一行 predictions（字段照 docs/contract/scripts.md），并登记 msg_map（message_id → session_id, turn_idx）。
提示词是本项目自写的（未照抄官方生成提示）；版本号 PROMPT_VERSION 进 config_hash。
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from .adapter import SYSTEM_FLAGS, BackendAdapter, ReplayCache, replay_item
from .common import looks_like_abstention
from .data import EvalItem, Turn
from .llm import ChatModel
from .retrieval import Embedder, top_k

PROMPT_VERSION = "e-p1"
SYSTEM_PROMPT = "You are a helpful assistant that remembers the user's past conversations with you."
MAX_ANSWER_TOKENS = 512


def format_turn_line(t: Turn, n: int | None = None) -> str:
    """上下文中的一行：`[n] (日期) role: 内容`（n 可省）；内容里的换行压成空格，保证一轮一行。"""
    content = " ".join(t.content.split())
    head = f"[{n}] " if n is not None else ""
    return f"{head}({t.date}) {t.role}: {content}"


def b1_prompt(item: EvalItem) -> list[dict[str, str]]:
    """B1 全量上下文：LongMemEval 为全部 session；BranchMem 不在 B1 的运行矩阵里（scripts.md），
    若仍要跑，只给提问节点的祖先路径（等价于一个按当前分支截断的长上下文）。"""
    if item.kind == "branchmem":
        anc = item.ancestors()
        sessions = [s for s in item.sessions if any(t.message_id in anc for t in s["turns"])]
    else:
        sessions = item.sessions
    parts = ["Below is the history of chat sessions between the user and you, in chronological order.", ""]
    for i, s in enumerate(sessions, 1):
        parts.append(f"### Session {i} (date: {s['date']})")
        parts.extend(format_turn_line(t) for t in s["turns"])
        parts.append("")
    parts += [
        f"Current date: {item.question_date}",
        f"Question: {item.question}",
        "Answer the question using the history above. If the history does not contain the information needed, say that you don't know.",
    ]
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": "\n".join(parts)}]


def b2_prompt(item: EvalItem, hits: list[Turn]) -> list[dict[str, str]]:
    parts = ["Below are records retrieved from your past chat sessions with the user, most relevant first.", ""]
    parts.extend(format_turn_line(t, i) for i, t in enumerate(hits, 1))
    parts += [
        "",
        f"Current date: {item.question_date}",
        f"Question: {item.question}",
        "Answer the question using only the records above, and cite every record you rely on by its number in square brackets, e.g. [2]. "
        "If none of the records contains the information needed, say that you don't know and cite nothing.",
    ]
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": "\n".join(parts)}]


_CITE = re.compile(r"\[(\d+)\]")


def parse_citations(text: str, n_hits: int) -> list[int]:
    """回答里的 [n]（1..n_hits）按出现顺序去重，返回 0 起的下标。越界编号丢弃。"""
    seen: list[int] = []
    for m in _CITE.finditer(text or ""):
        i = int(m.group(1))
        if 1 <= i <= n_hits and (i - 1) not in seen:
            seen.append(i - 1)
    return seen


@dataclass
class RunContext:
    system: str
    model: ChatModel | None
    k: int
    config_hash: str
    embedder: Embedder | None = None
    adapter: BackendAdapter | None = None
    cache: ReplayCache | None = None
    msg_map: dict[str, tuple[str, int]] = field(default_factory=dict)
    replay_totals: dict[str, float] = field(default_factory=lambda: {"replay_tokens_in": 0, "replay_tokens_out": 0, "replay_cost_usd": 0.0, "cache_hits": 0, "cache_misses": 0})


def _empty_row(item: EvalItem, ctx: RunContext) -> dict[str, Any]:
    return {
        "question_id": item.key,
        "question_type": item.qtype,
        "system": ctx.system,
        "config_hash": ctx.config_hash,
        "hypothesis": "",
        "cited_message_ids": [],
        "cited_session_ids": [],
        "retrieved_ids": [],
        "abstained": False,
        "branch_id": item.query_branch_id if item.kind == "branchmem" else None,
        "leaked_ids": [],
        "tokens_in": 0,
        "tokens_out": 0,
        "latency_ms": 0,
        "cost_usd": None,
        "error": None,
    }


def _finish(row: dict[str, Any], item: EvalItem, ctx: RunContext, cited: list[str], retrieved: list[tuple[str, float]]) -> None:
    """填引用、检索、泄漏字段，并登记 msg_map（只登记本行出现过的 message_id，足够复算指标）。"""
    for mid in cited + [m for m, _ in retrieved]:
        if mid not in ctx.msg_map:
            raise KeyError(f"message_id {mid} 不在 msg_map 里")
    row["cited_message_ids"] = cited
    sess: list[str] = []
    for mid in cited:
        s = ctx.msg_map[mid][0]
        if s not in sess:
            sess.append(s)
    row["cited_session_ids"] = sess
    row["retrieved_ids"] = [{"session_id": ctx.msg_map[m][0], "turn_idx": ctx.msg_map[m][1], "score": sc} for m, sc in retrieved]
    if item.kind == "branchmem":
        # leaked_ids：进入了回答上下文（检索到或被引用）但不在提问节点祖先路径上的消息。
        # 泄漏率另按 scripts.md 规则在 metrics.py 里判定（采用 distractor_value 或引用兄弟分支），不只看本字段。
        on_path = {(t.session_id, t.turn_idx) for t in item.turns if t.message_id in item.ancestors()}
        leaked: list[str] = []
        for mid in cited + [m for m, _ in retrieved]:
            if ctx.msg_map[mid] not in on_path and mid not in leaked:
                leaked.append(mid)
        row["leaked_ids"] = leaked
    row["abstained"] = looks_like_abstention(row["hypothesis"])


def run_b1(item: EvalItem, ctx: RunContext) -> dict[str, Any]:
    row = _empty_row(item, ctx)
    assert ctx.model is not None
    r = ctx.model.complete(b1_prompt(item), max_tokens=MAX_ANSWER_TOKENS)
    row.update(hypothesis=r.text, tokens_in=r.tokens_in, tokens_out=r.tokens_out, latency_ms=r.latency_ms, cost_usd=r.cost_usd)
    _finish(row, item, ctx, [], [])
    return row


def run_b2(item: EvalItem, ctx: RunContext) -> dict[str, Any]:
    """B2：每个轮次（user 与 assistant 都算，单 session 助手题的证据在 assistant 轮）是一个块，
    BranchMem 上不做分支过滤（朴素 RAG 看得到整棵树），按嵌入余弦取前 k，要求引用编号。"""
    row = _empty_row(item, ctx)
    assert ctx.model is not None and ctx.embedder is not None
    t0 = time.monotonic()
    hits = top_k(item.question, [t.content for t in item.turns], ctx.embedder, ctx.k)
    hit_turns = [item.turns[i] for i, _ in hits]
    for t in hit_turns:
        ctx.msg_map[t.message_id] = (t.session_id, t.turn_idx)
    r = ctx.model.complete(b2_prompt(item, hit_turns), max_tokens=MAX_ANSWER_TOKENS)
    cited = [hit_turns[i].message_id for i in parse_citations(r.text, len(hit_turns))]
    row.update(
        hypothesis=r.text,
        tokens_in=r.tokens_in,
        tokens_out=r.tokens_out,
        latency_ms=r.latency_ms or int((time.monotonic() - t0) * 1000),
        cost_usd=r.cost_usd,
    )
    _finish(row, item, ctx, cited, [(hit_turns[j].message_id, s) for j, (_, s) in enumerate(hits)])
    return row


def run_backend(item: EvalItem, ctx: RunContext) -> dict[str, Any]:
    """M 与 A1–A4：回放（按 session 缓存）→ 提问。tokens/cost 只计提问阶段；回放消耗累计在 replay_totals，
    由 run_eval 写进 run_summary.json（回放结果在各系统间共用，单独报告）。"""
    row = _empty_row(item, ctx)
    assert ctx.adapter is not None and ctx.cache is not None
    ctx.adapter.start_item(item)
    to_backend, stats = replay_item(ctx.adapter, ctx.cache, item)
    for k2, v in stats.items():
        ctx.replay_totals[k2] += v
    back_to_base = {b: base for base, b in to_backend.items()}
    by_id = {t.message_id: t for t in item.turns}
    for b, base in back_to_base.items():
        t = by_id[base]
        ctx.msg_map[b] = (t.session_id, t.turn_idx)
    parent = to_backend.get(item.query_parent_id) if item.query_parent_id else None
    flags = SYSTEM_FLAGS[ctx.system]
    r = ctx.adapter.ask(item, parent_backend_id=parent, to_backend=to_backend, flags=flags, k=ctx.k)
    # 后端可能引用/检索到不对应原始轮次的对象（如 L2/L3 记忆条目），它们无法映射到 (session_id, turn_idx)，
    # retrieved_ids 只收可映射的；引用里不可映射的保留在 cited_message_ids 外并记在 error 备注中。
    retrieved = [(m, s) for m, s in r.retrieved if m in ctx.msg_map]
    cited = [m for m in r.cited_message_ids if m in ctx.msg_map]
    unmapped = [m for m in r.cited_message_ids if m not in ctx.msg_map]
    row.update(
        hypothesis=r.hypothesis,
        tokens_in=r.tokens_in,
        tokens_out=r.tokens_out,
        latency_ms=r.latency_ms,
        cost_usd=r.cost_usd,
        branch_id=r.branch_id,
    )
    _finish(row, item, ctx, cited, retrieved)
    if unmapped:
        row["error"] = f"unmapped_citations:{','.join(unmapped)}"
    return row


def run_one(item: EvalItem, ctx: RunContext) -> dict[str, Any]:
    try:
        if ctx.system == "B1":
            return run_b1(item, ctx)
        if ctx.system == "B2":
            return run_b2(item, ctx)
        if ctx.system in SYSTEM_FLAGS:
            return run_backend(item, ctx)
        raise ValueError(f"未知系统：{ctx.system}")
    except NotImplementedError:
        raise
    except Exception as e:  # 单题失败不拖垮整轮，照实写进 error
        row = _empty_row(item, ctx)
        row["error"] = f"{type(e).__name__}: {e}"
        return row
