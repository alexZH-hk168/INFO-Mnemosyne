"""E：prep_longmemeval.py 与分层抽样（合成迷你数据，字段与官方一致）。"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import prep_longmemeval  # noqa: E402
from eval_lib.common import SEED, read_jsonl  # noqa: E402
from eval_lib.lme import QUESTION_TYPES, allocate, convert, download, stratified_sample  # noqa: E402

MINI = Path(__file__).resolve().parent / "data" / "eval_mini" / "longmemeval_mini.json"
CONTRACT_FIELDS = ["question_id", "question_type", "question", "answer", "question_date", "sessions", "answer_session_ids", "is_abstention"]


def raw():
    return json.loads(MINI.read_text(encoding="utf-8"))


def test_mini_covers_six_types_and_abstention():
    data = raw()
    types = Counter(e["question_type"] for e in data)
    assert set(types) == set(QUESTION_TYPES)
    assert sum(1 for e in data if e["question_id"].endswith("_abs")) == 3


def test_convert_contract_fields_and_turns():
    recs = [convert(e) for e in raw()]
    for r in recs:
        assert list(r) == CONTRACT_FIELDS
        for s in r["sessions"]:
            assert set(s) == {"session_id", "date", "turns"}
            for t in s["turns"]:
                assert set(t) == {"role", "content", "has_answer"} and isinstance(t["has_answer"], bool)
    by = {r["question_id"]: r for r in recs}
    assert by["mini_ssu_04_abs"]["is_abstention"] and not by["mini_ssu_01"]["is_abstention"]
    assert by["mini_ms_01"]["answer"] == 3  # 整数答案保留原类型
    assert by["mini_ssa_01"]["sessions"][1]["turns"][1]["has_answer"] is True
    assert [s["session_id"] for s in by["mini_ssu_01"]["sessions"]] == ["sharegpt_fillA_0", "answer_ssu01", "ultrachat_fillB"]


def test_convert_rejects_bad_rows():
    e = raw()[0]
    bad = dict(e)
    del bad["answer_session_ids"]
    with pytest.raises(ValueError, match="缺少官方字段"):
        convert(bad)
    bad = dict(e, haystack_dates=e["haystack_dates"][:1])
    with pytest.raises(ValueError, match="长度不一致"):
        convert(bad)
    bad = dict(e, question_type="single-hop")
    with pytest.raises(ValueError, match="6 类"):
        convert(bad)


def test_allocate_equal_with_caps_and_remainder():
    # 7 层、120 题：17×7=119，余 1 给池子最大的层
    pools = {"a": 133, "b": 133, "c": 70, "d": 56, "e": 30, "f": 78, "abstention": 30}
    al = allocate(pools, 120)
    assert sum(al.values()) == 120
    assert sorted(al.values()) == [17] * 6 + [18]
    assert al["a"] == 18  # 池子最大且层名最小
    # 小池子封顶，余量再分
    al = allocate({"x": 2, "y": 50, "z": 50}, 30)
    assert al == {"x": 2, "y": 14, "z": 14}
    with pytest.raises(ValueError):
        allocate({"x": 1}, 2)


def test_stratified_sample_deterministic_and_balanced():
    recs = [convert(e) for e in raw()]
    s1, al1 = stratified_sample(recs, 7, SEED)
    s2, al2 = stratified_sample(recs, 7, SEED)
    assert [r["question_id"] for r in s1] == [r["question_id"] for r in s2]
    assert al1 == al2 and all(v == 1 for v in al1.values()) and len(al1) == 7
    strata = Counter("abstention" if r["is_abstention"] else r["question_type"] for r in s1)
    assert all(v == 1 for v in strata.values())
    s3, _ = stratified_sample(recs, 7, SEED + 1)
    assert len(s3) == 7  # 换种子仍是 7 题（是否不同不做断言，迷你池很小）


def test_cli_dev_and_full(tmp_path):
    out = tmp_path / "dev.jsonl"
    assert prep_longmemeval.main(["--input", str(MINI), "--subset", "dev120", "--dev-size", "10", "--out", str(out)]) == 0
    rows = read_jsonl(out)
    meta = json.loads(Path(str(out) + ".meta.json").read_text(encoding="utf-8"))
    assert len(rows) == 10 and meta["n"] == 10 and meta["seed"] == SEED
    assert sum(meta["allocation"].values()) == 10
    assert meta["question_ids"] == [r["question_id"] for r in rows]
    full = tmp_path / "full.jsonl"
    prep_longmemeval.main(["--input", str(MINI), "--subset", "full", "--out", str(full)])
    assert len(read_jsonl(full)) == 16


def test_cli_requires_input_or_download(tmp_path):
    with pytest.raises(SystemExit):
        prep_longmemeval.main(["--subset", "full", "--out", str(tmp_path / "x.jsonl")])


def test_download_verifies_sha256(tmp_path, monkeypatch):
    """下载逻辑用假 opener 测（本轮不联网、不下载真实数据）。"""
    import io

    from eval_lib import lme

    payload = MINI.read_bytes()
    import hashlib

    # 云电脑 statvfs 报告的剩余空间可能为 0（配额显示），空间检查单独测，这里跳过
    monkeypatch.setattr(lme, "ensure_free_space", lambda *a, **k: None)

    monkeypatch.setitem(lme.SPLITS, "mini", {"file": "mini.json", "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)})
    p = download("mini", tmp_path, opener=lambda url: io.BytesIO(payload))
    assert p.read_bytes() == payload
    monkeypatch.setitem(lme.SPLITS, "bad", {"file": "bad.json", "sha256": "0" * 64, "size": len(payload)})
    with pytest.raises(ValueError, match="校验失败"):
        download("bad", tmp_path, opener=lambda url: io.BytesIO(payload))
    assert not (tmp_path / "bad.json").exists() and not (tmp_path / "bad.part").exists()


def test_ensure_free_space_raises(tmp_path, monkeypatch):
    from collections import namedtuple

    from eval_lib import common

    Usage = namedtuple("Usage", "total used free")
    monkeypatch.setattr(common.shutil, "disk_usage", lambda p: Usage(1000, 900, 100))
    with pytest.raises(OSError, match="磁盘空间不足"):
        common.ensure_free_space(tmp_path, 101)
    common.ensure_free_space(tmp_path, 100)
