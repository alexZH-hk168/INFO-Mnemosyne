"""LongMemEval 数据：官方字段核对、转换成契约（scripts.md）字段、分层抽样、下载与校验。

官方字段（核对来源见 server/scripts/README-eval.md「官方核对」一节）：
  question_id, question_type, question, answer, question_date,
  haystack_session_ids, haystack_dates, haystack_sessions, answer_session_ids；
  haystack_sessions 是 session 列表，每个 session 是 turn 列表 {role, content}，证据轮另带 has_answer: true。
  question_id 以 `_abs` 结尾的是拒答题（官方 README）；question_type 仍是 6 类之一。

契约输出（scripts.md）：
  question_id, question_type, question, answer, question_date, sessions[], answer_session_ids[], is_abstention
  sessions[] 的结构由本脚本定义（契约未写明，见未决 U100）：
    {session_id, date, turns: [{role, content, has_answer}]}，顺序与官方 haystack_* 三个列表一致，
    turn_idx 为 turns 列表下标（从 0 开始；官方检索代码的轮次 id 从 1 开始，见 U100）。
"""

from __future__ import annotations

import os
import random
import urllib.request
from pathlib import Path
from typing import Any

from .common import ensure_free_space, file_sha256

QUESTION_TYPES = (
    "single-session-user",
    "single-session-assistant",
    "single-session-preference",
    "multi-session",
    "knowledge-update",
    "temporal-reasoning",
)
ABSTENTION_STRATUM = "abstention"

REQUIRED_FIELDS = (
    "question_id",
    "question_type",
    "question",
    "answer",
    "question_date",
    "haystack_session_ids",
    "haystack_dates",
    "haystack_sessions",
    "answer_session_ids",
)

# Hugging Face xiaowu0162/longmemeval-cleaned（2025-09 清洗版）的文件；sha256/size 取自
# https://huggingface.co/api/datasets/xiaowu0162/longmemeval-cleaned/tree/main 的 lfs 字段（2026-11-23 查询）。
HF_BASE = "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/"
SPLITS: dict[str, dict[str, Any]] = {
    "s_cleaned": {
        "file": "longmemeval_s_cleaned.json",
        "sha256": "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
        "size": 277383467,
    },
    "oracle": {
        "file": "longmemeval_oracle.json",
        "sha256": "821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c",
        "size": 15388478,
    },
}


def is_abstention_qid(question_id: str) -> bool:
    return str(question_id).endswith("_abs")


def validate_raw(entry: dict[str, Any]) -> None:
    missing = [k for k in REQUIRED_FIELDS if k not in entry]
    if missing:
        raise ValueError(f"{entry.get('question_id', '?')} 缺少官方字段：{missing}")
    n = len(entry["haystack_session_ids"])
    if len(entry["haystack_dates"]) != n or len(entry["haystack_sessions"]) != n:
        raise ValueError(f"{entry['question_id']} 的 haystack_session_ids / dates / sessions 长度不一致")
    if entry["question_type"] not in QUESTION_TYPES:
        raise ValueError(f"{entry['question_id']} 的 question_type 不在官方 6 类里：{entry['question_type']!r}")
    for sess in entry["haystack_sessions"]:
        for turn in sess:
            if "role" not in turn or "content" not in turn:
                raise ValueError(f"{entry['question_id']} 有 turn 缺 role/content")


def convert(entry: dict[str, Any]) -> dict[str, Any]:
    """官方一条 → 契约一条。answer 保留原类型（清洗版里有整数答案，HF 预览报 answer 列含 int）。"""
    validate_raw(entry)
    sessions = []
    for sid, date, sess in zip(entry["haystack_session_ids"], entry["haystack_dates"], entry["haystack_sessions"]):
        sessions.append(
            {
                "session_id": sid,
                "date": date,
                "turns": [
                    {"role": t["role"], "content": t["content"], "has_answer": bool(t.get("has_answer", False))}
                    for t in sess
                ],
            }
        )
    return {
        "question_id": entry["question_id"],
        "question_type": entry["question_type"],
        "question": entry["question"],
        "answer": entry["answer"],
        "question_date": entry["question_date"],
        "sessions": sessions,
        "answer_session_ids": list(entry["answer_session_ids"]),
        "is_abstention": is_abstention_qid(entry["question_id"]),
    }


def stratum_of(rec: dict[str, Any]) -> str:
    return ABSTENTION_STRATUM if rec["is_abstention"] else rec["question_type"]


def allocate(pool_sizes: dict[str, int], n: int) -> dict[str, int]:
    """把 n 尽量平均分给各层；某层题不够就全取，余量再平均分给其它层。

    余数按（池子大小降序, 层名升序）依次多给 1 题。完全确定，不用随机数。
    """
    total = sum(pool_sizes.values())
    if n > total:
        raise ValueError(f"要抽 {n} 题，但总共只有 {total} 题")
    alloc = {k: 0 for k in pool_sizes}
    active = sorted(pool_sizes)
    remaining = n
    while True:
        if not active or remaining == 0:
            break
        share = remaining // len(active)
        capped = [k for k in active if pool_sizes[k] <= share]
        if not capped:
            rem = remaining - share * len(active)
            order = sorted(active, key=lambda k: (-pool_sizes[k], k))
            for k in active:
                alloc[k] = share
            for k in order[:rem]:
                alloc[k] += 1
            break
        for k in capped:
            alloc[k] = pool_sizes[k]
            remaining -= pool_sizes[k]
        active = [k for k in active if k not in capped]
    return alloc


def stratified_sample(records: list[dict[str, Any]], n: int, seed: int) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """按 6 类题型（非拒答）+ 拒答共 7 层分层抽 n 题；返回（按原顺序排列的样本, 每层分配数）。"""
    strata: dict[str, list[str]] = {}
    for r in records:
        strata.setdefault(stratum_of(r), []).append(r["question_id"])
    alloc = allocate({k: len(v) for k, v in strata.items()}, n)
    rng = random.Random(seed)
    chosen: set[str] = set()
    for k in sorted(strata):
        ids = sorted(strata[k])
        chosen.update(rng.sample(ids, alloc[k]))
    sample = [r for r in records if r["question_id"] in chosen]
    return sample, alloc


def download(split: str, dest_dir: str | Path, *, url_base: str = HF_BASE, opener=urllib.request.urlopen) -> Path:
    """下载官方文件到 dest_dir，校验大小与 sha256；已存在且校验通过则直接返回。

    本轮（2026-11-23）因磁盘只剩约 180 MB 不运行；s_cleaned 约 277 MB。
    """
    meta = SPLITS[split]
    dest_dir = Path(dest_dir)
    dest = dest_dir / meta["file"]
    if dest.exists() and dest.stat().st_size == meta["size"] and file_sha256(dest) == meta["sha256"]:
        return dest
    dest_dir.mkdir(parents=True, exist_ok=True)
    ensure_free_space(dest_dir, int(meta["size"] * 1.1) + 1_000_000)
    tmp = dest.with_suffix(".part")
    try:
        with opener(url_base + meta["file"]) as resp, open(tmp, "wb") as f:
            while True:
                b = resp.read(1 << 20)
                if not b:
                    break
                f.write(b)
        size = tmp.stat().st_size
        digest = file_sha256(tmp)
        if size != meta["size"] or digest != meta["sha256"]:
            raise ValueError(f"{meta['file']} 校验失败：size={size}, sha256={digest}")
        os.replace(tmp, dest)
    finally:
        if tmp.exists():
            tmp.unlink()
    return dest
