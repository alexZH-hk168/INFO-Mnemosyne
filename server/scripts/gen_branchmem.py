"""生成 BranchMem 探针（契约 docs/contract/scripts.md）。

输出 JSONL，每题一行：item_id, src_question_id, tree, query_node_id, gold_answer, distractor_value,
gold_path_session_ids, distractor_branch_session_ids, type（update | single）
另写：<输出>.stats.json（生成/跳过计数与原因）、<输出>.review.md（抽样 20 题的人工核对稿）。
树的结构与干扰值规则见 eval_lib/branchmem.py 文件头。

用法：
  python scripts/gen_branchmem.py --src longmemeval --input data/eval/longmemeval_s_cleaned_full.jsonl --n 150 --out data/eval/branchmem.jsonl
--input 是 prep_longmemeval.py --subset full 的输出（契约字段）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_lib.branchmem import generate, review_markdown  # noqa: E402
from eval_lib.common import SEED, read_jsonl, write_jsonl  # noqa: E402

SERVER = Path(__file__).resolve().parent.parent


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default="longmemeval", choices=["longmemeval"])
    ap.add_argument("--input", type=Path, default=SERVER / "data" / "eval" / "longmemeval_s_cleaned_full.jsonl")
    ap.add_argument("--n", type=int, default=150)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--review-n", type=int, default=20)
    ap.add_argument("--out", type=Path, default=SERVER / "data" / "eval" / "branchmem.jsonl")
    args = ap.parse_args(argv)

    records = read_jsonl(args.input)
    items, stats = generate(records, args.n, args.seed)
    write_jsonl(args.out, items)
    stats["seed"] = args.seed
    stats["input"] = str(args.input)
    Path(str(args.out) + ".stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=1), encoding="utf-8")
    Path(str(args.out) + ".review.md").write_text(review_markdown(items, args.review_n, args.seed), encoding="utf-8")
    summary = {k: stats[k] for k in ("target", "generated", "candidates", "by_type", "skipped", "shortfall")}
    print(json.dumps(summary, ensure_ascii=False))
    if stats["shortfall"]:
        print(f"注意：只生成了 {stats['generated']} 题，比目标 {args.n} 少 {stats['shortfall']} 题（见 stats.json 的跳过原因）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
