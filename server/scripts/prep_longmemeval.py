"""准备 LongMemEval_S（cleaned）评测数据（契约 docs/contract/scripts.md）。

输出 JSONL，每题一行：question_id, question_type, question, answer, question_date, sessions[], answer_session_ids[], is_abstention
另写 <输出>.meta.json：来源文件与 sha256、种子、子集、各层分配数、题号列表。

用法：
  python scripts/prep_longmemeval.py --input data/longmemeval_s_cleaned.json --subset dev120 --out data/eval/lme_dev120.jsonl
  python scripts/prep_longmemeval.py --input data/longmemeval_s_cleaned.json --subset full   --out data/eval/lme_full.jsonl
  python scripts/prep_longmemeval.py --download --subset full     # 从 Hugging Face 下载（约 277 MB）并校验 sha256
--subset dev120：按 6 类题型（非拒答）+ 拒答共 7 层分层抽样，种子默认 20261121，题数默认 120（--dev-size 可改，仅测试用）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from eval_lib.common import SEED, file_sha256, write_jsonl  # noqa: E402
from eval_lib.lme import SPLITS, convert, download, stratified_sample  # noqa: E402

SERVER = Path(__file__).resolve().parent.parent


def load_raw(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        text_head = f.read(256).lstrip()[:1]
    if text_head == "[":
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--split", default="s_cleaned", choices=sorted(SPLITS))
    ap.add_argument("--subset", default="dev120", choices=["dev120", "full"])
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--input", type=Path, help="本地官方 JSON 文件（不给则必须 --download）")
    ap.add_argument("--download", action="store_true", help="从 Hugging Face 下载官方文件并校验 sha256")
    ap.add_argument("--download-dir", type=Path, default=SERVER / "data" / "longmemeval")
    ap.add_argument("--dev-size", type=int, default=120)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)

    if args.input is None:
        if not args.download:
            ap.error("需要 --input 本地文件，或显式加 --download")
        args.input = download(args.split, args.download_dir)
    raw = load_raw(args.input)
    records = [convert(e) for e in raw]
    ids = [r["question_id"] for r in records]
    if len(set(ids)) != len(ids):
        raise SystemExit("question_id 有重复")

    alloc = None
    if args.subset == "dev120":
        records, alloc = stratified_sample(records, args.dev_size, args.seed)
    out = args.out or (SERVER / "data" / "eval" / f"longmemeval_{args.split}_{args.subset}.jsonl")
    n = write_jsonl(out, records)
    meta = {
        "split": args.split,
        "subset": args.subset,
        "seed": args.seed,
        "source": str(args.input),
        "source_sha256": file_sha256(args.input),
        "n": n,
        "allocation": alloc,
        "question_ids": [r["question_id"] for r in records],
    }
    Path(str(out) + ".meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"out": str(out), "n": n, "allocation": alloc}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
