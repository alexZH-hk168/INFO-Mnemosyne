"""E：gen_branchmem.py——正确证据在提问节点祖先路径、干扰值在兄弟分支。"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import gen_branchmem  # noqa: E402
from eval_lib.branchmem import generate, minus_one_minute, pick_distractor  # noqa: E402
from eval_lib.common import SEED, contains_phrase, read_jsonl  # noqa: E402
from eval_lib.data import item_from_branchmem  # noqa: E402
from eval_lib.lme import convert  # noqa: E402

MINI = Path(__file__).resolve().parent / "data" / "eval_mini" / "longmemeval_mini.json"
FIELDS = ["item_id", "src_question_id", "tree", "query_node_id", "gold_answer", "distractor_value", "gold_path_session_ids", "distractor_branch_session_ids", "type"]


def recs():
    return [convert(e) for e in json.loads(MINI.read_text(encoding="utf-8"))]


def path_to_root(nodes: dict, nid: str) -> list[str]:
    out = []
    cur = nodes[nid]["parent_id"]
    while cur is not None:
        out.append(cur)
        cur = nodes[cur]["parent_id"]
    return out


def test_generate_structure():
    items, stats = generate(recs(), 150, SEED)
    # 迷你池：3 道知识更新 + 3 道单 session 用户（不含拒答）
    assert stats["generated"] == 6 and stats["shortfall"] == 144 and stats["candidates"] == 6
    assert stats["by_type"] == {"update": 3, "single": 3}
    for it in items:
        assert list(it) == FIELDS
        nodes = {n["node_id"]: n for n in it["tree"]["nodes"]}
        q = nodes[it["query_node_id"]]
        anc = path_to_root(nodes, it["query_node_id"])
        anc_sessions = {nodes[a]["session_id"] for a in anc}
        # ① 正确证据 session 与全部 has_answer 轮都在提问节点的祖先路径上
        assert set(it["gold_path_session_ids"]) <= anc_sessions
        assert all(n["node_id"] in anc for n in nodes.values() if n["has_answer"])
        assert any(contains_phrase(nodes[a]["content"], it["gold_answer"]) and nodes[a]["has_answer"] for a in anc)
        # ② 干扰分支与提问节点互为兄弟，且不在祖先路径上
        dnodes = [n for n in nodes.values() if n["branch_id"] == "br_distractor"]
        assert dnodes and all(n["node_id"] not in anc for n in dnodes)
        droot = [n for n in dnodes if n["parent_id"] == q["parent_id"]]
        assert len(droot) == 1
        assert {n["session_id"] for n in dnodes} == set(it["distractor_branch_session_ids"])
        # ③ 干扰值只出现在兄弟分支，正确答案不出现在含干扰值的轮里
        assert any(n["is_distractor"] and contains_phrase(n["content"], it["distractor_value"]) for n in dnodes)
        assert not any(contains_phrase(nodes[a]["content"], it["distractor_value"]) for a in anc)
        assert it["distractor_value"] != it["gold_answer"]
        assert not any(n["has_answer"] for n in dnodes)
        # ④ 兄弟分支日期晚于主干全部 session（更“新”，不按分支过滤就容易被误导）
        assert all(n["date"] >= max(m["date"] for m in nodes.values() if m["branch_id"] == "main" and m["session_id"]) for n in dnodes)


def test_knowledge_update_uses_latest_evidence_and_numeric_distractor():
    items, _ = generate(recs(), 150, SEED)
    by = {it["src_question_id"]: it for it in items}
    gym = by["mini_ku_02"]
    assert gym["type"] == "update" and gym["distractor_value"] in {"5", "6", "7"}
    dn = [n for n in gym["tree"]["nodes"] if n["branch_id"] == "br_distractor"]
    assert dn[0]["session_id"] == "answer_ku02b__distractor"  # 用最新一次更新所在 session
    assert contains_phrase(dn[0]["content"], gym["distractor_value"] + " days a week")
    city = by["mini_ku_01"]
    assert city["distractor_branch_session_ids"] == ["answer_ku01b__distractor"]
    assert city["distractor_value"] in {"Business Administration", "Chengdu", "Mochi", "Senior Data Analyst"}


def test_deterministic_and_skips():
    a, _ = generate(recs(), 150, SEED)
    b, _ = generate(recs(), 150, SEED)
    assert json.dumps(a) == json.dumps(b)
    rs = recs()
    for r in rs:
        if r["question_id"] == "mini_ssu_03":
            r["answer"] = "a city in Sichuan"  # 证据轮里不逐字出现 → 跳过
    _, st = generate(rs, 150, SEED)
    assert st["skipped"]["answer_not_verbatim"] == 1 and "mini_ssu_03" in st["skipped_ids"]["answer_not_verbatim"]
    items, st = generate(recs(), 4, SEED)
    assert st["generated"] == 4 and st["shortfall"] == 0


def test_pick_distractor_rules():
    rng = random.Random(1)
    assert pick_distractor("10 days", [], rng) in {"11 days", "12 days", "13 days"}
    assert pick_distractor("Mochi", ["Mochi", "Mochi the cat"], rng) is None  # 互相包含的不用
    assert pick_distractor("Red", ["Blue", "A very long answer string"], rng) == "Blue"
    assert minus_one_minute("2023/06/10 (Sat) 10:00") == "2023/06/10 (Sat) 09:59"


def test_eval_item_view_matches_tree():
    items, _ = generate(recs(), 150, SEED)
    it = item_from_branchmem(items[0])
    anc = it.ancestors()
    assert all(t.message_id in anc for t in it.turns if t.has_answer)
    assert not any(t.message_id in anc for t in it.turns if t.session_id in it.distractor_sessions)
    assert it.query_branch_id == "main" and it.judge_task in {"knowledge-update", "single-session-user"}


def test_cli_outputs_review(tmp_path):
    src = tmp_path / "full.jsonl"
    src.write_text("".join(json.dumps(r) + "\n" for r in recs()), encoding="utf-8")
    out = tmp_path / "bm.jsonl"
    assert gen_branchmem.main(["--input", str(src), "--n", "150", "--review-n", "3", "--out", str(out)]) == 0
    assert len(read_jsonl(out)) == 6
    st = json.loads(Path(str(out) + ".stats.json").read_text(encoding="utf-8"))
    assert st["shortfall"] == 144 and st["seed"] == SEED
    md = Path(str(out) + ".review.md").read_text(encoding="utf-8")
    assert md.count("## bm-") == 3 and "干扰值" in md
