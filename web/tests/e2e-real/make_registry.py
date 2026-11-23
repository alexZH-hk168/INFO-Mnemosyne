"""真实后端冒烟专用 registry：复制 server/registry，把 arxiv 插件的启动命令换成仓库里的本地假 MCP 服务
（server/tests/fake_mcp_server.py），其余字段（id、名称、简称、许可证、权限、证据映射）不变。

这样冒烟能走通“市场安装 → 自检 → 输入框插件区显示已启用插件”，不访问网络、不下载 arxiv-mcp-server。
用法：python make_registry.py <输出目录>
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parents[3] / "server"


def main(out: str) -> None:
    dst = Path(out)
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SERVER / "registry" / "skills.json", dst / "skills.json")
    items = json.loads((SERVER / "registry" / "plugins.json").read_text(encoding="utf-8"))
    hit = 0
    for it in items:
        if it["id"] == "arxiv":
            m = it["manifest"]
            m["command"] = sys.executable
            m["args"] = [str(SERVER / "tests" / "fake_mcp_server.py")]
            m["tools_allow"] = ["search", "fetch"]
            hit += 1
    assert hit == 1, "registry 里没有 arxiv 插件"
    (dst / "plugins.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
