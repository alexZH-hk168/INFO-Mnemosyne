"""E：run_eval.py（B1/B2/M/A1–A4，假模型与桩适配器）、judge.py（假判分器）、metrics.py（从文件复算）。"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import gen_branchmem  # noqa: E402
import judge  # noqa: E402
import metrics  # noqa: E402
import prep_longmemeval  # noqa: E402
import run_eval  # noqa: E402
from eval_lib.adapter import SYSTEM_FLAGS, Flags  # noqa: E402
from eval_lib.common import config_hash, read_jsonl  # noqa: E402
from eval_lib.data import load_items  # noqa: E402
from eval_lib.judge_prompts import get_anscheck_prompt, label_from_response  # noqa: E402
from eval_lib.llm import FakeChat, OpenAICompatChat, PaidCallBlocked, Pricing, fake_judge_responder, make_chat  # noqa: E402
from eval_lib.metrics_core import aggregate, compute_table, session_recall_all, turn_recall_all  # noqa: E402

MINI = Path(__file__).resolve().parent / "data" / "eval_mini" / "longmemeval_mini.json"
PRED_FIELDS = [
    "question_id", "question_type", "system", "config_hash", "hypothesis", "cited_message_ids", "cited_session_ids",
    "retrieved_ids", "abstained", "branch_id", "leaked_ids", "tokens_in", "tokens_out", "latency_ms", "cost_usd", "error",
]


@pytest.fixture(scope="module")
def data(tmp_path_factory):
    d = tmp_path_factory.mktemp("eval")
    full, dev, bm = d / "full.jsonl", d / "dev.jsonl", d / "bm.jsonl"
    prep_longmemeval.main(["--input", str(MINI), "--subset", "full", "--out", str(full)])
    prep_longmemeval.main(["--input", str(MINI), "--subset", "dev120", "--dev-size", "7", "--out", str(dev)])
    gen_branchmem.main(["--input", str(full), "--n", "150", "--out", str(bm)])
    return {"dir": d, "full": full, "dev": dev, "bm": bm}


def run(data, system, dataset="full", extra=(), name=None):
    out = data["dir"] / "runs" / (name or f"{dataset}-{system}")
    argv = ["--system", system, "--data", str(data[dataset]), "--model", "fake", "--out", str(out), "--max-items", "0", *extra]
    if system in SYSTEM_FLAGS:
        argv += ["--adapter", "stub"]
    assert run_eval.main(argv) == 0
    return out, read_jsonl(out / "predictions.jsonl"), {m["message_id"]: (m["session_id"], m["turn_idx"]) for m in read_jsonl(out / "msg_map.jsonl")}


def check_rows(rows, msg_map):
    assert len({r["config_hash"] for r in rows}) == 1
    for r in rows:
        assert list(r) == PRED_FIELDS
        assert r["error"] is None, r["error"]
        for mid in r["cited_message_ids"]:
            assert mid in msg_map
        assert r["cited_session_ids"] == list(dict.fromkeys(msg_map[m][0] for m in r["cited_message_ids"]))
        scores = [x["score"] for x in r["retrieved_ids"]]
        assert scores == sorted(scores, reverse=True)


# ---------- run_eval ----------


def test_b1_full_context(data):
    out, rows, mm = run(data, "B1")
    assert len(rows) == 16
    check_rows(rows, mm)
    assert all(r["retrieved_ids"] == [] and r["cited_message_ids"] == [] for r in rows)
    by = {r["question_id"]: r for r in rows}
    assert "Mochi" in by["mini_ssu_02"]["hypothesis"] and by["mini_ssu_02"]["tokens_in"] > 0
    summ = json.loads((out / "run_summary.json").read_text(encoding="utf-8"))
    assert summ["n_items"] == 16 and summ["cost_usd_per_q"] is None  # 未给单价 → 不编造费用


def test_b2_naive_rag_cites_retrieved_turns(data):
    _, rows, mm = run(data, "B2", extra=["--k", "3"])
    check_rows(rows, mm)
    for r in rows:
        assert len(r["retrieved_ids"]) == 3
        rset = {(x["session_id"], x["turn_idx"]) for x in r["retrieved_ids"]}
        assert all(tuple(mm[c]) in rset for c in r["cited_message_ids"])  # 只能引用检索到的轮次
    by = {r["question_id"]: r for r in rows}
    assert by["mini_ssu_02"]["cited_session_ids"] == ["answer_ssu02"]
    assert by["mini_ssa_01"]["retrieved_ids"][0] == {"session_id": "answer_ssa01", "turn_idx": 1, "score": by["mini_ssa_01"]["retrieved_ids"][0]["score"]}


def test_max_items_default_is_10(data):
    out = data["dir"] / "runs" / "default-max"
    run_eval.main(["--system", "B2", "--data", str(data["full"]), "--model", "fake", "--out", str(out)])
    assert len(read_jsonl(out / "predictions.jsonl")) == 10
    assert run_eval.DEFAULT_MAX_ITEMS == 10


def test_resume_keeps_done_rows(data):
    out = data["dir"] / "runs" / "resume"
    base = ["--system", "B2", "--data", str(data["full"]), "--model", "fake", "--out", str(out)]
    run_eval.main(base + ["--max-items", "5"])
    run_eval.main(base + ["--max-items", "0", "--resume"])
    ids = [r["question_id"] for r in read_jsonl(out / "predictions.jsonl")]
    assert len(ids) == 16 and len(set(ids)) == 16


def test_m_and_ablations_with_stub(data):
    hashes = {}
    for s in ("M", "A1", "A2", "A4"):
        out, rows, mm = run(data, s)
        check_rows(rows, mm)
        hashes[s] = rows[0]["config_hash"]
        summ = json.loads((out / "run_summary.json").read_text(encoding="utf-8"))
        # 填充 session 在多题间共用 → 按 session 缓存命中
        assert summ["replay"]["cache_hits"] > 0 and summ["replay"]["cache_misses"] > 0
        if s == "A2":
            assert all(r["cited_message_ids"] == [] for r in rows)
        else:
            assert any(r["cited_message_ids"] for r in rows)
    assert len(set(hashes.values())) == 4


def _backend_env(monkeypatch, tmp_path):
    """真实适配器会改 MN_DATA_DIR / MN_LLM_BACKEND 等环境变量：先登记，测试结束由 monkeypatch 还原。"""
    for k in ("MN_DATA_DIR", "MN_LLM_BACKEND", "MN_LLM_MODEL", "MN_EMBED_BACKEND", "MN_DB_PATH", "MN_SETTINGS_PATH", "MN_EVAL_CHAT_MODEL"):
        monkeypatch.setenv(k, os.environ.get(k, ""))
    monkeypatch.setenv("MN_DATA_DIR", str(tmp_path / "unused"))
    monkeypatch.setenv("MN_EMBED_BACKEND", "fake")


def run_backend(data, system, dataset, root):
    out = root / f"{dataset}-{system}"
    argv = ["--system", system, "--data", str(data[dataset]), "--model", "fake", "--out", str(out), "--max-items", "0",
            "--adapter", "backend", "--backend-data", str(root / "backend_data"), "--cache-dir", str(root / "replay_cache")]
    assert run_eval.main(argv) == 0
    summ = json.loads((out / "run_summary.json").read_text(encoding="utf-8"))
    return summ, read_jsonl(out / "predictions.jsonl"), {m["message_id"]: (m["session_id"], m["turn_idx"]) for m in read_jsonl(out / "msg_map.jsonl")}


def test_backend_adapter_runs_m_and_ablations_on_mini(data, monkeypatch, tmp_path):
    """INT1：系统 M 走后端真实 Python API（B2 回合 + B3a 记忆任务，假模型），A1/A2/A4 复用同题回放。"""
    _backend_env(monkeypatch, tmp_path)
    root = tmp_path / "runs"
    summ, rows, mm = run_backend(data, "M", "full", root)
    check_rows(rows, mm)
    assert len(rows) == 16 and summ["n_errors"] == 0
    assert summ["replay"]["cache_misses"] > 0 and summ["replay"]["cache_hits"] == 0  # 每题独立库：不跨题复用（U111）
    assert all(m.startswith("msg_") for m in mm)  # 后端分配的真实 message_id
    assert all(r["hypothesis"] and "[[E" not in r["hypothesis"] for r in rows)
    assert any(r["cited_message_ids"] for r in rows) and any(r["retrieved_ids"] for r in rows)
    assert all(r["tokens_in"] > 0 and r["cost_usd"] is None for r in rows)
    # 每题一个独立数据库
    dbs = sorted((root / "backend_data" / "items").glob("*/mnemosyne.db"))
    assert len(dbs) == 16
    for s in ("A1", "A2", "A4"):
        summ2, rows2, mm2 = run_backend(data, s, "full", root)
        check_rows(rows2, mm2)
        assert summ2["replay"]["cache_misses"] == 0 and summ2["replay"]["cache_hits"] == summ["replay"]["cache_misses"]
        if s == "A2":
            assert all(r["cited_message_ids"] == [] for r in rows2)


def test_backend_adapter_branchmem_scope(data, monkeypatch, tmp_path):
    _backend_env(monkeypatch, tmp_path)
    root = tmp_path / "runs"
    items = {it.key: it for it in load_items(read_jsonl(data["bm"]))}
    _, m_rows, m_map = run_backend(data, "M", "bm", root)
    _, a3_rows, a3_map = run_backend(data, "A3", "bm", root)
    for rows, mm in ((m_rows, m_map), (a3_rows, a3_map)):
        check_rows(rows, mm)
        assert all(r["branch_id"] == "main" for r in rows)
    for r in m_rows:  # M：召回与引用都不越出提问节点的祖先路径
        assert r["leaked_ids"] == []
        assert not any(x["session_id"] in items[r["question_id"]].distractor_sessions for x in r["retrieved_ids"])
    assert any(r["leaked_ids"] for r in a3_rows)  # A3 不按分支过滤：兄弟分支进入召回


def test_backend_adapter_isolates_eval_questions(data, monkeypatch, tmp_path):
    """同一数据目录重跑：命中回放缓存，且上一轮的提问没有写进记忆（两次结果相同）。"""
    _backend_env(monkeypatch, tmp_path)
    root = tmp_path / "runs"
    _, first, _ = run_backend(data, "M", "full", root)
    summ, second, _ = run_backend(data, "A4", "full", root)
    _, third, _ = run_backend(data, "M", "full", root)
    assert [r["hypothesis"] for r in third] == [r["hypothesis"] for r in first]
    assert [r["retrieved_ids"] for r in third] == [r["retrieved_ids"] for r in first]


def test_backend_adapter_paid_gate(monkeypatch, tmp_path):
    from eval_lib.adapter import make_adapter
    from eval_lib.llm import PaidCallBlocked

    _backend_env(monkeypatch, tmp_path)
    monkeypatch.delenv("MN_EVAL_ALLOW_PAID", raising=False)
    with pytest.raises(PaidCallBlocked):
        make_adapter("backend", model="gpt-4o-mini", data_dir=tmp_path / "bd")


def test_backend_to_iso():
    from eval_lib.backend import to_iso

    assert to_iso("2023/05/20 (Sat) 02:21", "x") == "2023-05-20T02:21:00Z"
    assert to_iso("2023-5-2", "x") == "2023-05-02T00:00:00Z"
    assert to_iso("", "fallback") == "fallback"


def test_branchmem_scope_vs_a3_vs_b2(data):
    _, m_rows, m_map = run(data, "M", "bm")
    _, a3_rows, a3_map = run(data, "A3", "bm")
    _, b2_rows, b2_map = run(data, "B2", "bm")
    items = {it.key: it for it in load_items(read_jsonl(data["bm"]))}
    for rows, mm in ((m_rows, m_map), (a3_rows, a3_map), (b2_rows, b2_map)):
        check_rows(rows, mm)
        assert all(r["branch_id"] == "main" for r in rows)
    # M：检索与引用都不越出提问节点的祖先路径
    for r in m_rows:
        assert r["leaked_ids"] == []
        assert not any(x["session_id"] in items[r["question_id"]].distractor_sessions for x in r["retrieved_ids"])
    # A3 与 B2 不按分支过滤：兄弟分支进入检索结果
    assert any(r["leaked_ids"] for r in a3_rows)
    assert any(r["leaked_ids"] for r in b2_rows)


def test_paid_gate(monkeypatch, data):
    monkeypatch.delenv("MN_EVAL_ALLOW_PAID", raising=False)
    with pytest.raises(PaidCallBlocked):
        make_chat("gpt-4o-2024-08-06")
    with pytest.raises(PaidCallBlocked):
        run_eval.main(["--system", "B2", "--data", str(data["full"]), "--model", "some-model", "--out", str(data["dir"] / "runs" / "paid")])
    with pytest.raises(PaidCallBlocked):
        judge.main(["--pred", str(data["full"]), "--data", str(data["full"]), "--judge", "gpt-4o"])


def test_openai_compat_request_and_usage(monkeypatch):
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": " Yes "}}], "usage": {"prompt_tokens": 120, "completion_tokens": 1}})

    monkeypatch.setenv("MN_EVAL_ALLOW_PAID", "1")
    monkeypatch.setenv("MN_EVAL_API_BASE", "http://judge.local/v1")
    chat = OpenAICompatChat("gpt-4o-2024-08-06", api_key="", pricing=Pricing(2.5, 10.0), transport=httpx.MockTransport(handler))
    r = chat.complete([{"role": "user", "content": "q"}], max_tokens=10, temperature=0)
    assert seen["url"] == "http://judge.local/v1/chat/completions"
    assert seen["body"]["model"] == "gpt-4o-2024-08-06" and seen["body"]["max_tokens"] == 10 and seen["body"]["temperature"] == 0
    assert r.text == "Yes" and r.tokens_in == 120 and r.tokens_out == 1
    assert r.cost_usd == pytest.approx(120 * 2.5 / 1e6 + 10.0 / 1e6)


def test_config_hash_stable_and_sensitive():
    a = {"system": "M", "k": 8, "flags": Flags().__dict__}
    assert config_hash(a) == config_hash(dict(reversed(list(a.items()))))
    assert config_hash(a) != config_hash({**a, "k": 10})
    assert SYSTEM_FLAGS["A3"] == Flags(branch_scope=False) and SYSTEM_FLAGS["A2"].citations is False


# ---------- judge ----------


def test_official_prompt_routing():
    p = get_anscheck_prompt("knowledge-update", "Q", "A", "R")
    assert "updated answer" in p and p.endswith("Is the model response correct? Answer yes or no only.")
    assert "off-by-one" in get_anscheck_prompt("temporal-reasoning", "Q", "A", "R")
    assert "Rubric: A" in get_anscheck_prompt("single-session-preference", "Q", "A", "R")
    assert "unanswerable question" in get_anscheck_prompt("multi-session", "Q", "A", "R", abstention=True)
    assert "Correct Answer: 3" in get_anscheck_prompt("multi-session", "Q", 3, "R")
    with pytest.raises(NotImplementedError):
        get_anscheck_prompt("abstention", "Q", "A", "R")
    # 官方判定：回复里含 yes 即对（照搬官方行为，包括它的子串判断）
    assert label_from_response(" Yes.") and not label_from_response("no") and label_from_response("no, yes")


def test_judge_fake_and_routing(data):
    _, rows, _ = run(data, "B2", name="judge-src")
    items = {it.key: it for it in load_items(read_jsonl(data["full"]))}
    chat = FakeChat(fake_judge_responder, name="fake")
    out = judge.judge_rows(rows, items, chat, "fake")
    assert [o["question_id"] for o in out] == [r["question_id"] for r in rows]
    assert all(list(o) == ["question_id", "correct", "judge_raw", "judge_model", "config_hash"] for o in out)
    assert all(o["correct"] in (0, 1) and o["judge_raw"] in ("yes", "no") for o in out)
    prompts = {r["question_id"]: c[-1]["content"] for r, c in zip(rows, chat.calls)}
    assert "unanswerable question" in prompts["mini_ku_04_abs"]
    assert "updated answer" in prompts["mini_ku_01"]
    assert "Rubric:" in prompts["mini_ssp_01"]
    by = {o["question_id"]: o["correct"] for o in out}
    assert by["mini_ssu_02"] == 1  # 回答原样含 Mochi


def test_judge_branchmem_uses_query_and_task(data):
    _, rows, _ = run(data, "M", "bm", name="judge-bm")
    items = {it.key: it for it in load_items(read_jsonl(data["bm"]))}
    chat = FakeChat(fake_judge_responder)
    judge.judge_rows(rows, items, chat, "fake")
    for r, c in zip(rows, chat.calls):
        it = items[r["question_id"]]
        p = c[-1]["content"]
        assert f"Question: {it.question}\n" in p and f"Correct Answer: {it.answer}\n" in p
        assert ("updated answer" in p) == (it.qtype == "update")


# ---------- metrics ----------


def test_recall_definitions():
    ret = [{"session_id": "s1", "turn_idx": 0, "score": 0.9}, {"session_id": "s1", "turn_idx": 1, "score": 0.8}, {"session_id": "s2", "turn_idx": 0, "score": 0.7}]
    assert session_recall_all(ret, ["s1", "s2"], 2) == 1.0  # 去重后前 2 个 session
    assert session_recall_all(ret, ["s1", "s2"], 1) == 0.0
    assert session_recall_all(ret, [], 2) is None
    assert turn_recall_all(ret, {("s2", 0)}, 2) == 0.0 and turn_recall_all(ret, {("s2", 0)}, 3) == 1.0


def test_aggregate_hand_computed(data):
    items = {it.key: it for it in load_items(read_jsonl(data["full"]))}

    def row(qid, cited, retrieved, tin=10, tout=2, lat=100):
        return {"question_id": qid, "question_type": items[qid].qtype, "system": "B2", "hypothesis": "", "cited_message_ids": cited,
                "retrieved_ids": [{"session_id": s, "turn_idx": t, "score": 1.0} for s, t in retrieved], "leaked_ids": [],
                "tokens_in": tin, "tokens_out": tout, "latency_ms": lat}

    mm = {"a": ("answer_ssu02", 0), "b": ("answer_ssu02", 1), "c": ("answer_ms01a", 0)}
    rows = [
        row("mini_ssu_02", ["a", "b"], [("answer_ssu02", 0)], lat=100),  # 证据全中；引用 2 中 1
        row("mini_ms_01", ["c"], [("answer_ms01a", 0)], lat=300),  # 两个证据 session 只中 1 → 0；引用 1 中 1
        row("mini_ssu_04_abs", [], [], lat=200),  # 拒答题：不计召回与引用命中
    ]
    judged = {"mini_ssu_02": 1, "mini_ms_01": 0, "mini_ssu_04_abs": 1}
    m = aggregate(rows, judged, items, mm, k=8)
    assert m["n"] == 3 and m["qa_acc"] == round(2 / 3, 4)
    assert m["recall@k_session"] == 0.5 and m["recall@k_turn"] == 0.5
    assert m["cited_turn_hit_rate"] == round(2 / 3, 4)
    assert m["abstention_acc"] == 1.0 and m["branch_acc"] is None and m["leak_rate"] is None
    assert m["tokens_per_q"] == 12 and m["latency_p50"] == 200
    for r in rows:
        r["system"] = "A2"
    assert aggregate(rows, judged, items, mm, k=8)["cited_turn_hit_rate"] is None  # A2 不适用


def test_branchmem_leak_rule(data):
    items = {it.key: it for it in load_items(read_jsonl(data["bm"]))}
    it = next(iter(items.values()))
    dmid = next(t.message_id for t in it.turns if t.session_id in it.distractor_sessions)
    gmid = next(t.message_id for t in it.turns if t.has_answer)
    mm = {t.message_id: (t.session_id, t.turn_idx) for t in it.turns}
    base = {"question_id": it.key, "question_type": it.qtype, "system": "M", "retrieved_ids": [], "leaked_ids": [], "tokens_in": 0, "tokens_out": 0, "latency_ms": 0}
    cases = [
        ({**base, "hypothesis": f"It is {it.answer}.", "cited_message_ids": [gmid]}, False),
        ({**base, "hypothesis": f"It is {it.distractor_value}.", "cited_message_ids": [gmid]}, True),  # 采用干扰值
        ({**base, "hypothesis": f"It is {it.answer}.", "cited_message_ids": [dmid]}, True),  # 引用兄弟分支
    ]
    for r, leak in cases:
        m = aggregate([r], {it.key: 1}, items, mm, k=8)
        assert m["leak_rate"] == (1.0 if leak else 0.0) and m["branch_acc"] == 1.0


def test_metrics_cli_recomputes_from_files(data, tmp_path):
    outs = []
    for s in ("B2", "M"):
        out, rows, _ = run(data, s, name=f"metrics-{s}")
        judge.main(["--pred", str(out / "predictions.jsonl"), "--data", str(data["full"]), "--judge", "fake"])
        outs.append(out)
    res = tmp_path / "m.json"
    argv = ["--pred", *[str(o / "predictions.jsonl") for o in outs], "--judged", *[str(o / "judged-fake.jsonl") for o in outs],
            "--data", str(data["full"]), "--dev-ids", str(data["dev"]), "--out", str(res)]
    assert metrics.main(argv) == 0
    table = json.loads(res.read_text(encoding="utf-8"))["rows"]
    res2 = tmp_path / "m2.json"
    metrics.main(argv[:-1] + [str(res2)])
    assert json.loads(res2.read_text(encoding="utf-8"))["rows"] == table  # 同样输入 → 同样结果
    for o in outs:
        preds = read_jsonl(o / "predictions.jsonl")
        jd = {j["question_id"]: j["correct"] for j in read_jsonl(o / "judged-fake.jsonl")}
        sysname = preds[0]["system"]
        full_all = next(r for r in table if r["split"] == "full" and r["system"] == sysname and r["question_type"] == "ALL")
        assert full_all["n"] == 16 and full_all["qa_acc"] == round(sum(jd.values()) / 16, 4)
        dev = {r["question_id"] for r in read_jsonl(data["dev"])}
        held = next(r for r in table if r["split"] == "heldout" and r["system"] == sysname and r["question_type"] == "ALL")
        assert held["n"] == 16 - len(dev) == 9
        assert held["qa_acc"] == round(sum(v for k, v in jd.items() if k not in dev) / 9, 4)
        types = {r["question_type"] for r in table if r["system"] == sysname and r["split"] == "full"}
        assert len(types) == 7  # ALL + 6 类
    # 判分与预测的 config_hash 不一致时拒绝
    bad = tmp_path / "bad.jsonl"
    bad.write_text("".join(json.dumps({**j, "config_hash": "x"}) + "\n" for j in read_jsonl(outs[0] / "judged-fake.jsonl")), encoding="utf-8")
    with pytest.raises(SystemExit):
        metrics.main(["--pred", str(outs[0] / "predictions.jsonl"), "--judged", str(bad), "--data", str(data["full"])])


def test_compute_table_requires_judged(data):
    items = {it.key: it for it in load_items(read_jsonl(data["full"]))}
    with pytest.raises(ValueError, match="没有判分"):
        compute_table([{"question_id": "mini_ssu_01", "system": "B2", "question_type": "single-session-user"}], {}, items, {}, 8)
