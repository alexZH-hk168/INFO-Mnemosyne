"""跑一个系统配置（契约 docs/contract/scripts.md）。

输出（--out 目录）：
  predictions.jsonl：question_id, question_type, system, config_hash, hypothesis, cited_message_ids, cited_session_ids,
                     retrieved_ids（有序 [{session_id, turn_idx, score}]）, abstained, branch_id, leaked_ids,
                     tokens_in, tokens_out, latency_ms, cost_usd, error
  msg_map.jsonl：每行 {message_id, session_id, turn_idx}（只登记 predictions 里出现过的 message_id）
  run_summary.json：配置、config_hash、题数、单题平均 token 与费用、回放消耗与缓存命中

系统：B1 全量上下文；B2 朴素 RAG（按轮切块、取前 k、要求引用）；M 完整系统；A1 去回溯原文；A2 去证据锚点；
      A3 去分支作用域（只在 BranchMem 上跑）；A4 去 L4 画像。M/A* 经 --adapter 调后端。

预算硬约束（未决 U2）：--max-items 默认 10。真跑前先在 dev-120 上只跑 M 的前 10 题，看 run_summary.json 的
单题 token 与费用，等用户确认预算后再用 --max-items 0（不限）扩大。非 fake 模型还要设 MN_EVAL_ALLOW_PAID=1。

用法：
  python scripts/run_eval.py --system B2 --data data/eval/lme_dev120.jsonl --model fake --out runs/dev120-B2
  python scripts/run_eval.py --system M --data data/eval/lme_dev120.jsonl --model <模型> --adapter backend \\
      --price-in <每百万输入 token 美元> --price-out <每百万输出 token 美元> --out runs/dev120-M   # 默认只跑前 10 题
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_lib.adapter import SYSTEM_FLAGS, ReplayCache, make_adapter  # noqa: E402
from eval_lib.common import (  # noqa: E402
    ALL_SYSTEMS,
    BRANCHMEM_SYSTEMS,
    LME_SYSTEMS,
    SEED,
    append_jsonl,
    config_hash,
    file_sha256,
    read_jsonl,
    write_jsonl,
)
from eval_lib.data import load_items  # noqa: E402
from eval_lib.llm import Pricing, make_chat  # noqa: E402
from eval_lib.retrieval import make_embedder  # noqa: E402
from eval_lib.systems import PROMPT_VERSION, RunContext, run_one  # noqa: E402

DEFAULT_MAX_ITEMS = 10


def build_config(args, data_sha: str) -> dict:
    cfg = {
        "system": args.system,
        "model": args.model,
        "k": args.k,
        "data_sha256": data_sha,
        "seed": args.seed,
        "prompt_version": PROMPT_VERSION,
    }
    if args.system == "B2":
        cfg["embed"] = args.embed
    if args.system in SYSTEM_FLAGS:
        cfg["adapter"] = args.adapter
        cfg["flags"] = SYSTEM_FLAGS[args.system].__dict__
    return cfg


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--system", required=True, choices=ALL_SYSTEMS)
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--model", required=True, help="fake 或 OpenAI 兼容接口的模型名")
    ap.add_argument("--k", type=int, default=8)
    ap.add_argument("--out", required=True, type=Path, help="输出目录")
    ap.add_argument("--max-items", type=int, default=DEFAULT_MAX_ITEMS, help="只跑前 N 题；0 表示不限（预算确认后才用）")
    ap.add_argument("--embed", default="hash", help="B2 的嵌入器：hash（本地测试）或 openai:<模型名>")
    ap.add_argument("--adapter", default="backend", choices=["backend", "stub"], help="M/A1–A4 的后端适配器；stub 只用于流水线自检")
    ap.add_argument("--cache-dir", type=Path, help="回放缓存目录（M/A* 共用）；默认 <out>/../replay_cache")
    ap.add_argument("--price-in", type=float, help="每百万输入 token 美元（按所选模型官方价目填）")
    ap.add_argument("--price-out", type=float, help="每百万输出 token 美元")
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--resume", action="store_true", help="保留同 config_hash 已完成的题，只补跑缺的")
    args = ap.parse_args(argv)

    records = read_jsonl(args.data)
    items = load_items(records)
    kind = items[0].kind if items else "lme"
    matrix = BRANCHMEM_SYSTEMS if kind == "branchmem" else LME_SYSTEMS
    if args.system not in matrix:
        print(f"提示：{args.system} 不在 {kind} 的运行矩阵 {matrix} 里（scripts.md），照常运行", file=sys.stderr)
    if args.max_items > 0:
        items = items[: args.max_items]

    cfg = build_config(args, file_sha256(args.data))
    chash = config_hash(cfg)
    pricing = Pricing(args.price_in, args.price_out)
    model = make_chat(args.model, pricing=pricing) if args.system in ("B1", "B2") else None
    ctx = RunContext(system=args.system, model=model, k=args.k, config_hash=chash)
    if args.system == "B2":
        ctx.embedder = make_embedder(args.embed)
    if args.system in SYSTEM_FLAGS:
        ctx.adapter = make_adapter(args.adapter)
        if args.cache_dir is None and args.adapter == "stub":
            ctx.cache = ReplayCache(None)  # 桩的消息只在内存里，不落盘
        else:
            ctx.cache = ReplayCache(args.cache_dir or (args.out.parent / "replay_cache"))

    args.out.mkdir(parents=True, exist_ok=True)
    pred_path = args.out / "predictions.jsonl"
    map_path = args.out / "msg_map.jsonl"
    done: set[str] = set()
    if args.resume and pred_path.exists():
        kept = [r for r in read_jsonl(pred_path) if r["config_hash"] == chash and not r["error"]]
        done = {r["question_id"] for r in kept}
        write_jsonl(pred_path, kept)
        if map_path.exists():
            for m in read_jsonl(map_path):
                ctx.msg_map[m["message_id"]] = (m["session_id"], m["turn_idx"])
    else:
        pred_path.write_text("", encoding="utf-8")

    t0 = time.monotonic()
    rows = []
    for it in items:
        if it.key in done:
            continue
        row = run_one(it, ctx)
        append_jsonl(pred_path, row)
        rows.append(row)
    write_jsonl(map_path, ({"message_id": m, "session_id": s, "turn_idx": t} for m, (s, t) in sorted(ctx.msg_map.items())))

    all_rows = [r for r in read_jsonl(pred_path)]
    costs = [r["cost_usd"] for r in all_rows]
    n = len(all_rows)
    summary = {
        "config": cfg,
        "config_hash": chash,
        "n_items": n,
        "n_errors": sum(1 for r in all_rows if r["error"]),
        "tokens_in_per_q": round(statistics.mean(r["tokens_in"] for r in all_rows), 1) if n else None,
        "tokens_out_per_q": round(statistics.mean(r["tokens_out"] for r in all_rows), 1) if n else None,
        "cost_usd_per_q": round(statistics.mean(costs), 6) if n and all(c is not None for c in costs) else None,
        "cost_usd_total": round(sum(costs), 6) if n and all(c is not None for c in costs) else None,
        "replay": ctx.replay_totals if args.system in SYSTEM_FLAGS else None,
        "wall_s": round(time.monotonic() - t0, 2),
        "max_items": args.max_items,
    }
    (args.out / "run_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
