"""下载测试用的 arXiv 论文到 server/tests/data/。

arXiv 1706.03762（Attention Is All You Need）在 arXiv 上的许可是
“arXiv.org perpetual, non-exclusive license”（http://arxiv.org/licenses/nonexclusive-distrib/1.0/），
不允许我们再分发，所以 PDF 不提交进仓库（.gitignore 排除），测试前运行本脚本下载。
固定 v7，与前端 F4 量 bbox 用的版本一致；下载后核对 sha256。
"""

from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "tests" / "data"
FILES = {
    "1706.03762v7.pdf": (
        "https://arxiv.org/pdf/1706.03762v7",
        "bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697",
    ),
}


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    for name, (url, digest) in FILES.items():
        dest = DATA / name
        if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == digest:
            print(f"已存在 {dest}")
            continue
        req = urllib.request.Request(url, headers={"User-Agent": "mnemosyne-tests/0.1"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
        got = hashlib.sha256(data).hexdigest()
        if got != digest:
            print(f"{name} sha256 不符：{got}", file=sys.stderr)
            return 1
        dest.write_bytes(data)
        print(f"已下载 {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
