"""BranchMem 构造：把 LongMemEval 的知识更新题与单 session 用户题改造成消息树。

树（tree.nodes，每个节点一条消息）：
  主干 branch_id="main"：该题全部 haystack session 按时间顺序串成一条链（session k 的首轮挂在 session k-1 的末轮下）；
  提问节点 query：挂在主干末轮下，branch_id="main"，内容是原问题、日期是原 question_date；
  兄弟分支 branch_id="br_distractor"：也挂在主干末轮下（与提问节点互为兄弟），是证据 session 的副本，
    其中正确答案被替换成 distractor_value，日期比提问早 1 分钟（比主干所有证据都新，
    所以不按分支过滤、偏好最新信息的系统会被它误导）。副本节点 has_answer=false、is_distractor 标出含干扰值的轮。
正确证据（answer_session_ids、has_answer 轮）都在提问节点的祖先路径上。

distractor_value 用规则生成（不调模型）：
  答案里有数字 → 第一个数字加 1–3（随机、固定种子）；否则 → 从候选池其它题的答案里挑词数相差 ≤1、互不包含的一个。
  证据轮里找不到逐字出现的答案、或挑不到干扰值的题跳过，并按原因计数。规则生成的干扰值可能语义不通顺，
  这正是要人工抽查 20 题的原因（立项稿 11.1、13 章）。
"""

from __future__ import annotations

import random
import re
from datetime import datetime, timedelta
from typing import Any

from .common import contains_phrase, normalize_text

TYPE_OF = {"knowledge-update": "update", "single-session-user": "single"}
DATE_FMT = "%Y/%m/%d (%a) %H:%M"
_NUM = re.compile(r"\d+(?:\.\d+)?")


def node_id(session_id: str, turn_idx: int) -> str:
    return f"{session_id}::{turn_idx}"


def minus_one_minute(date: str) -> str:
    try:
        return (datetime.strptime(date, DATE_FMT) - timedelta(minutes=1)).strftime(DATE_FMT)
    except ValueError:
        return date


def _replace_phrase(text: str, old: str, new: str) -> str:
    """按词边界、不区分大小写替换 old → new。"""
    pat = re.compile(r"(?<!\w)" + re.escape(old) + r"(?!\w)", re.IGNORECASE)
    return pat.sub(new, text)


def pick_distractor(gold: str, pool: list[str], rng: random.Random) -> str | None:
    m = _NUM.search(gold)
    if m:
        num = m.group(0)
        delta = rng.choice([1, 2, 3])
        new = str(int(num) + delta) if "." not in num else f"{float(num) + delta:g}"
        return gold[: m.start()] + new + gold[m.end() :]
    wc = len(normalize_text(gold).split())
    cands = sorted(
        {
            p
            for p in pool
            if p
            and not _NUM.search(p)
            and abs(len(normalize_text(p).split()) - wc) <= 1
            and not contains_phrase(p, gold)
            and not contains_phrase(gold, p)
        }
    )
    return rng.choice(cands) if cands else None


def evidence_turn(rec: dict[str, Any], gold: str) -> tuple[int, int] | None:
    """返回 (session 下标, turn 下标)：answer_session_ids 中 has_answer 且逐字含答案的轮，取时间上最后一个
    （知识更新题即最新一次更新）。"""
    found = None
    gold_sessions = set(rec["answer_session_ids"])
    for si, s in enumerate(rec["sessions"]):
        if s["session_id"] not in gold_sessions:
            continue
        for ti, t in enumerate(s["turns"]):
            if t.get("has_answer") and contains_phrase(t["content"], gold):
                found = (si, ti)
    return found


def build_item(rec: dict[str, Any], distractor: str, ev: tuple[int, int]) -> dict[str, Any]:
    gold = str(rec["answer"])
    nodes: list[dict[str, Any]] = []
    parent = None
    for s in rec["sessions"]:
        for ti, t in enumerate(s["turns"]):
            nid = node_id(s["session_id"], ti)
            nodes.append(
                {
                    "node_id": nid,
                    "parent_id": parent,
                    "branch_id": "main",
                    "session_id": s["session_id"],
                    "turn_idx": ti,
                    "role": t["role"],
                    "content": t["content"],
                    "date": s["date"],
                    "has_answer": bool(t.get("has_answer")),
                    "is_distractor": False,
                }
            )
            parent = nid
    fork = parent
    ev_sess = rec["sessions"][ev[0]]
    dsid = f"{ev_sess['session_id']}__distractor"
    ddate = minus_one_minute(rec["question_date"])
    dparent = fork
    for ti, t in enumerate(ev_sess["turns"]):
        content = _replace_phrase(t["content"], gold, distractor)
        nid = node_id(dsid, ti)
        nodes.append(
            {
                "node_id": nid,
                "parent_id": dparent,
                "branch_id": "br_distractor",
                "session_id": dsid,
                "turn_idx": ti,
                "role": t["role"],
                "content": content,
                "date": ddate,
                "has_answer": False,
                "is_distractor": contains_phrase(content, distractor),
            }
        )
        dparent = nid
    qid = f"q::{rec['question_id']}"
    nodes.append(
        {
            "node_id": qid,
            "parent_id": fork,
            "branch_id": "main",
            "session_id": None,
            "turn_idx": None,
            "role": "user",
            "content": rec["question"],
            "date": rec["question_date"],
            "has_answer": False,
            "is_distractor": False,
        }
    )
    return {
        "item_id": f"bm-{rec['question_id']}",
        "src_question_id": rec["question_id"],
        "tree": {"nodes": nodes, "fork_node_id": fork},
        "query_node_id": qid,
        "gold_answer": gold,
        "distractor_value": distractor,
        "gold_path_session_ids": list(rec["answer_session_ids"]),
        "distractor_branch_session_ids": [dsid],
        "type": TYPE_OF[rec["question_type"]],
    }


def generate(records: list[dict[str, Any]], n: int, seed: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rng = random.Random(seed)
    cands = sorted(
        (r for r in records if r["question_type"] in TYPE_OF and not r["is_abstention"]),
        key=lambda r: r["question_id"],
    )
    rng.shuffle(cands)
    pool = sorted({str(r["answer"]) for r in cands})
    items: list[dict[str, Any]] = []
    skipped: dict[str, list[str]] = {"answer_not_verbatim": [], "no_distractor": []}
    for r in cands:
        if len(items) >= n:
            break
        gold = str(r["answer"])
        ev = evidence_turn(r, gold)
        if ev is None:
            skipped["answer_not_verbatim"].append(r["question_id"])
            continue
        d = pick_distractor(gold, [p for p in pool if p != gold], rng)
        if d is None:
            skipped["no_distractor"].append(r["question_id"])
            continue
        items.append(build_item(r, d, ev))
    items.sort(key=lambda it: it["item_id"])
    stats = {
        "target": n,
        "generated": len(items),
        "candidates": len(cands),
        "by_type": {t: sum(1 for it in items if it["type"] == t) for t in ("update", "single")},
        "skipped": {k: len(v) for k, v in skipped.items()},
        "skipped_ids": skipped,
        "shortfall": max(0, n - len(items)),
    }
    return items, stats


def review_markdown(items: list[dict[str, Any]], k: int, seed: int) -> str:
    """抽样 k 题的人工核对稿：问题、正确答案、干扰值、主干证据轮、兄弟分支对应轮。"""
    rng = random.Random(seed + 1)
    picked = sorted(rng.sample(items, min(k, len(items))), key=lambda it: it["item_id"])
    lines = [f"# BranchMem 人工核对（抽样 {len(picked)} / {len(items)} 题，种子 {seed}）", ""]
    lines.append("核对点：①正确答案确实由主干证据轮支持；②干扰值与正确答案矛盾且读起来合理；③兄弟分支只改了答案这一处。")
    lines.append("")
    for it in picked:
        nodes = {n["node_id"]: n for n in it["tree"]["nodes"]}
        q = nodes[it["query_node_id"]]
        ev = [n for n in it["tree"]["nodes"] if n["branch_id"] == "main" and n["has_answer"]]
        dv = [n for n in it["tree"]["nodes"] if n["is_distractor"]]
        main_n = sum(1 for n in it["tree"]["nodes"] if n["branch_id"] == "main")
        lines += [
            f"## {it['item_id']}（{it['type']}，源题 {it['src_question_id']}）",
            "",
            f"- 问题：{q['content']}",
            f"- 正确答案：{it['gold_answer']}",
            f"- 干扰值：{it['distractor_value']}",
            f"- 主干节点数：{main_n}（含提问节点）；兄弟分支 session：{', '.join(it['distractor_branch_session_ids'])}",
            "",
            "主干证据轮：",
            "",
        ]
        lines += [f"> [{n['session_id']} #{n['turn_idx']} · {n['role']} · {n['date']}] {n['content'][:400]}" for n in ev] or ["> （无）"]
        lines += ["", "兄弟分支含干扰值的轮：", ""]
        lines += [f"> [{n['session_id']} #{n['turn_idx']} · {n['role']} · {n['date']}] {n['content'][:400]}" for n in dv] or ["> （无）"]
        lines += ["", "- [ ] 通过　- [ ] 不通过，原因：", ""]
    return "\n".join(lines)
