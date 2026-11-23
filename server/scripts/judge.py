"""判分（契约 docs/contract/scripts.md）：按 LongMemEval 官方 evaluate_qa.py 的提示模板与判定规则。

输出 JSONL，每题一行：question_id, correct（0/1）, judge_raw；另附 judge_model、config_hash（来自 predictions，便于核对配对）。
默认写到 predictions 同目录的 judged-<judge>.jsonl。

--judge gpt-4o（官方主判分，对应 gpt-4o-2024-08-06）| gpt-4o-mini（官方 model_zoo 里的便宜判分，敏感性检查用）| fake（测试用）
真实判分是付费调用：需要 MN_EVAL_ALLOW_PAID=1，且只能在用户确认预算后运行。
BranchMem：题面取提问节点内容，答案取 gold_answer；update 题用官方 knowledge-update 模板，single 题用 single-session-user 模板。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_lib.common import read_jsonl, write_jsonl  # noqa: E402
from eval_lib.data import load_items  # noqa: E402
from eval_lib.judge_prompts import JUDGE_MODELS, JUDGE_PARAMS, get_anscheck_prompt, is_abstention_official, label_from_response  # noqa: E402
from eval_lib.llm import make_chat  # noqa: E402


def judge_rows(preds: list[dict], items_by_id: dict, chat, judge_model: str) -> list[dict]:
    out = []
    for p in preds:
        it = items_by_id.get(p["question_id"])
        if it is None:
            print(f"警告：{p['question_id']} 不在 --data 里，跳过（与官方脚本行为一致）", file=sys.stderr)
            continue
        abst = is_abstention_official(it.key) if it.kind == "lme" else False
        prompt = get_anscheck_prompt(it.judge_task, it.question, it.answer, p["hypothesis"], abstention=abst)
        r = chat.complete([{"role": "user", "content": prompt}], max_tokens=JUDGE_PARAMS["max_tokens"], temperature=JUDGE_PARAMS["temperature"])
        raw = r.text.strip()
        out.append(
            {
                "question_id": p["question_id"],
                "correct": 1 if label_from_response(raw) else 0,
                "judge_raw": raw,
                "judge_model": judge_model,
                "config_hash": p.get("config_hash"),
            }
        )
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pred", required=True, type=Path)
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--judge", default="gpt-4o", choices=sorted(JUDGE_MODELS) + ["fake"])
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)

    items = {it.key: it for it in load_items(read_jsonl(args.data))}
    preds = read_jsonl(args.pred)
    judge_model = "fake" if args.judge == "fake" else JUDGE_MODELS[args.judge]
    chat = make_chat(judge_model if args.judge != "fake" else "fake", role="judge")
    rows = judge_rows(preds, items, chat, judge_model)
    out = args.out or args.pred.parent / f"judged-{args.judge}.jsonl"
    write_jsonl(out, rows)
    acc = sum(r["correct"] for r in rows) / len(rows) if rows else None
    print(json.dumps({"out": str(out), "n": len(rows), "accuracy": acc, "judge_model": judge_model}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
