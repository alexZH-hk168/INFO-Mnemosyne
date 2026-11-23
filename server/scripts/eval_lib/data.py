"""把 prep_longmemeval.py 与 gen_branchmem.py 的输出统一成评测用的 EvalItem。

LongMemEval（契约字段 question_id…is_abstention）：每个历史轮次一条 Turn，message_id = `{session_id}::{turn_idx}`。
BranchMem（契约字段 item_id…type）：tree.nodes 里除提问节点外的每个节点一条 Turn，message_id = node_id。
基线 B1/B2 直接用这些 message_id；系统 M 的真实消息 id 由后端分配，经 msg_map.jsonl 映射回 (session_id, turn_idx)。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

BRANCHMEM_TASK = {"update": "knowledge-update", "single": "single-session-user"}


def lme_message_id(session_id: str, turn_idx: int) -> str:
    return f"{session_id}::{turn_idx}"


@dataclass
class Turn:
    message_id: str
    session_id: str
    turn_idx: int
    role: str
    content: str
    date: str
    has_answer: bool
    branch_id: str | None = None
    parent_id: str | None = None


@dataclass
class EvalItem:
    kind: str  # 'lme' | 'branchmem'
    key: str  # question_id / item_id
    qtype: str  # question_type / type
    question: str
    question_date: str
    answer: Any
    is_abstention: bool
    turns: list[Turn]
    sessions: list[dict[str, Any]]  # 回放单位：[{session_id, date, turns:[Turn], parent_message_id}]
    gold_sessions: list[str]
    gold_turns: set[tuple[str, int]]
    distractor_value: str | None = None
    distractor_sessions: list[str] = field(default_factory=list)
    query_node_id: str | None = None
    query_parent_id: str | None = None
    query_branch_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def judge_task(self) -> str:
        return BRANCHMEM_TASK[self.qtype] if self.kind == "branchmem" else self.qtype

    def ancestors(self) -> set[str]:
        """提问节点到根的路径上的 message_id（不含提问节点）。LongMemEval 为全部消息。"""
        if self.kind != "branchmem":
            return {t.message_id for t in self.turns}
        by_id = {t.message_id: t for t in self.turns}
        out: set[str] = set()
        cur = self.query_parent_id
        while cur is not None:
            out.add(cur)
            cur = by_id[cur].parent_id if cur in by_id else None
        return out


def item_from_lme(rec: dict[str, Any]) -> EvalItem:
    turns: list[Turn] = []
    sessions = []
    for s in rec["sessions"]:
        st = []
        for i, t in enumerate(s["turns"]):
            tt = Turn(lme_message_id(s["session_id"], i), s["session_id"], i, t["role"], t["content"], s["date"], bool(t.get("has_answer")))
            turns.append(tt)
            st.append(tt)
        sessions.append({"session_id": s["session_id"], "date": s["date"], "turns": st, "parent_message_id": None})
    gold_turns = {(t.session_id, t.turn_idx) for t in turns if t.has_answer}
    return EvalItem(
        kind="lme",
        key=rec["question_id"],
        qtype=rec["question_type"],
        question=rec["question"],
        question_date=rec["question_date"],
        answer=rec["answer"],
        is_abstention=bool(rec["is_abstention"]),
        turns=turns,
        sessions=sessions,
        gold_sessions=list(rec["answer_session_ids"]),
        gold_turns=gold_turns,
        raw=rec,
    )


def item_from_branchmem(rec: dict[str, Any]) -> EvalItem:
    nodes = rec["tree"]["nodes"]
    q = next(n for n in nodes if n["node_id"] == rec["query_node_id"])
    turns: list[Turn] = []
    sessions: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for n in nodes:
        if n["node_id"] == rec["query_node_id"]:
            continue
        t = Turn(n["node_id"], n["session_id"], n["turn_idx"], n["role"], n["content"], n["date"], bool(n.get("has_answer")), n["branch_id"], n["parent_id"])
        turns.append(t)
        if n["session_id"] not in sessions:
            sessions[n["session_id"]] = {"session_id": n["session_id"], "date": n["date"], "turns": [], "parent_message_id": n["parent_id"]}
            order.append(n["session_id"])
        sessions[n["session_id"]]["turns"].append(t)
    gold_turns = {(t.session_id, t.turn_idx) for t in turns if t.has_answer}
    return EvalItem(
        kind="branchmem",
        key=rec["item_id"],
        qtype=rec["type"],
        question=q["content"],
        question_date=q["date"],
        answer=rec["gold_answer"],
        is_abstention=False,
        turns=turns,
        sessions=[sessions[s] for s in order],
        gold_sessions=list(rec["gold_path_session_ids"]),
        gold_turns=gold_turns,
        distractor_value=rec["distractor_value"],
        distractor_sessions=list(rec["distractor_branch_session_ids"]),
        query_node_id=rec["query_node_id"],
        query_parent_id=q["parent_id"],
        query_branch_id=q["branch_id"],
        raw=rec,
    )


def load_items(records: list[dict[str, Any]]) -> list[EvalItem]:
    out = []
    for r in records:
        if "tree" in r:
            out.append(item_from_branchmem(r))
        elif "sessions" in r:
            out.append(item_from_lme(r))
        else:
            raise ValueError("数据行既不是 LongMemEval（sessions）也不是 BranchMem（tree）")
    return out
