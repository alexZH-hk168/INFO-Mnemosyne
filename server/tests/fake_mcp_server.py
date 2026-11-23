"""测试用的极小 stdio MCP 服务（基于已装的官方 mcp SDK 2.x 的 MCPServer），不联网、不下载依赖。

参数：
  --pid-file PATH   启动后把进程号写进文件（测试据此确认进程已被回收）
  --delay SECONDS   握手前先睡这么久（模拟启动 / tools/list 卡住，触发自检超时）
工具：search（带 URL 的论文记录）、note（无 URL 的条目）、fetch（模拟 Fetch MCP：返回 “Contents of …” 文本）、
     slow（睡眠，测超时）、boom（抛异常，测报错）、env（读环境变量，测配置注入）、hidden（不在 tools_allow 里）。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time

from mcp.server.mcpserver import MCPServer

app = MCPServer("mnemosyne-fake")


@app.tool()
def search(query: str) -> str:
    """Search fake papers."""
    papers = [
        {"id": "1706.03762", "title": "Attention Is All You Need", "url": "https://arxiv.org/pdf/1706.03762",
         "abstract": f"The dominant sequence transduction models ... ({query})", "authors": ["Vaswani", "Shazeer"]},
        {"id": "2410.10813", "title": "LongMemEval", "url": "https://arxiv.org/pdf/2410.10813",
         "abstract": "Benchmarking chat assistants on long-term interactive memory.", "authors": ["Wu"]},
    ]
    return json.dumps({"total_results": 2, "papers": papers}, ensure_ascii=False)


@app.tool()
def note(key: str) -> str:
    """Return a note without URL."""
    return json.dumps({"title": f"笔记 {key}", "body": "反向传播按链式法则逐层求梯度。", "tags": ["作业3", "BP"]}, ensure_ascii=False)


@app.tool()
def fetch(url: str, max_length: int = 5000) -> str:
    """Fake fetch."""
    return f"Contents of {url}:\nScaled dot-product attention divides by sqrt(d_k)."[:max_length]


@app.tool()
async def slow(seconds: float = 5.0) -> str:
    """Sleep then return."""
    await asyncio.sleep(seconds)
    return "slept"


@app.tool()
def boom() -> str:
    """Always fails."""
    raise RuntimeError("fake failure")


@app.tool()
def env(name: str) -> str:
    """Read an environment variable."""
    return os.environ.get(name, "<unset>")


@app.tool()
def hidden() -> str:
    """Not exposed by tools_allow."""
    return "hidden"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pid-file")
    ap.add_argument("--delay", type=float, default=0.0)
    args = ap.parse_args()
    if args.pid_file:
        with open(args.pid_file, "w") as f:
            f.write(str(os.getpid()))
    print(f"[fake-mcp] starting server (stdio), pid={os.getpid()}", file=sys.stderr, flush=True)
    if args.delay:
        print(f"[fake-mcp] sleeping {args.delay}s before handshake", file=sys.stderr, flush=True)
        time.sleep(args.delay)
    app.run()


if __name__ == "__main__":
    main()
