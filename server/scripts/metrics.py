"""计算指标（契约 docs/contract/scripts.md）：按系统与题型输出
qa_acc, recall@k_session, recall@k_turn, cited_turn_hit_rate, abstention_acc, branch_acc, leak_rate, tokens_per_q, latency_p50。
口径见 eval_lib/metrics_core.py 文件头。全部数字只从 predictions、judged、msg_map 与 --data 复算，不读任何中间缓存。

--pred 与 --judged 可各给多个，按顺序一一配对（每个 predictions 文件是一个系统配置）。
msg_map 默认取每个 predictions 同目录的 msg_map.jsonl。
--dev-ids 给 dev-120 文件（prep 输出的 jsonl）时，LongMemEval 另报「heldout」（全量中未参与调参的题，正式数据为 380 题）。

用法：
  python scripts/metrics.py --pred runs/full-B2/predictions.jsonl runs/full-M/predictions.jsonl \\
      --judged runs/full-B2/judged-gpt-4o.jsonl runs/full-M/judged-gpt-4o.jsonl \\
      --data data/eval/lme_full.jsonl --dev-ids data/eval/lme_dev120.jsonl --out runs/metrics_lme.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_lib.common import read_jsonl  # noqa: E402
from eval_lib.data import load_items  # noqa: E402
from eval_lib.metrics_core import METRIC_FIELDS, compute_table  # noqa: E402


def load_dev_ids(path: Path) -> set[str]:
    if path.suffix == ".json":
        return set(json.loads(path.read_text(encoding="utf-8"))["question_ids"])
    return {r["question_id"] for r in read_jsonl(path)}


def to_markdown(table: list[dict]) -> str:
    cols = ["split", "system", "question_type", "n", *METRIC_FIELDS]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in table:
        lines.append("| " + " | ".join("—" if r[c] is None else str(r[c]) for c in cols) + " |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pred", required=True, nargs="+", type=Path)
    ap.add_argument("--judged", required=True, nargs="+", type=Path)
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--msg-map", nargs="+", type=Path, help="默认取各 predictions 同目录的 msg_map.jsonl")
    ap.add_argument("--dev-ids", type=Path)
    ap.add_argument("--k", type=int, default=8)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    if len(args.pred) != len(args.judged):
        ap.error("--pred 与 --judged 个数要相同")
    maps = args.msg_map or [p.parent / "msg_map.jsonl" for p in args.pred]
    if len(maps) != len(args.pred):
        ap.error("--msg-map 个数要与 --pred 相同")

    items = {it.key: it for it in load_items(read_jsonl(args.data))}
    dev = load_dev_ids(args.dev_ids) if args.dev_ids else None
    table: list[dict] = []
    for pp, jp, mp in zip(args.pred, args.judged, maps):
        preds = read_jsonl(pp)
        systems = {p["system"] for p in preds}
        hashes = {p["config_hash"] for p in preds}
        if len(systems) != 1 or len(hashes) != 1:
            raise SystemExit(f"{pp} 混有多个系统或配置：{systems} {hashes}")
        jrows = read_jsonl(jp)
        bad = {j.get("config_hash") for j in jrows} - hashes - {None}
        if bad:
            raise SystemExit(f"{jp} 的 config_hash {bad} 与 {pp} 不一致")
        judged = {j["question_id"]: int(j["correct"]) for j in jrows}
        msg_map = {m["message_id"]: (m["session_id"], m["turn_idx"]) for m in read_jsonl(mp)} if mp.exists() else {}
        table.extend(compute_table(preds, judged, items, msg_map, args.k, dev))
    order = {"full": 0, "heldout": 1}
    table.sort(key=lambda r: (order[r["split"]], r["system"], r["question_type"] != "ALL", r["question_type"]))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"k": args.k, "rows": table}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(to_markdown(table))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
