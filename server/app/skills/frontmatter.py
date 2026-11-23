"""SKILL.md 头部（YAML front matter）解析。

依赖里没有 YAML 库，这里只解析 Skill 头部实际会用到的子集：顶层 `key: value`（值可带单/双引号）、
`key: >` / `key: |` 块标量（后续缩进行）、以及顶层键下的嵌套块（如 `metadata:`，整体跳过、值记为 None）。
不认识的写法不报错，只忽略该行；必需字段 name / description 缺失由调用方判 SKILL_INVALID。
"""

from __future__ import annotations

import re

_KEY = re.compile(r"^([A-Za-z_][\w-]*)\s*:\s?(.*)$")


class FrontMatterError(ValueError):
    pass


def split(text: str) -> tuple[str, str]:
    """返回（头部文本，正文）。没有以 `---` 开头的头部时抛 FrontMatterError。"""
    text = text.lstrip("\ufeff")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise FrontMatterError("SKILL.md 开头没有 --- 包起来的头部")
    for i in range(1, len(lines)):
        if lines[i].strip() in ("---", "..."):
            return "\n".join(lines[1:i]), "\n".join(lines[i + 1:]).lstrip("\n")
    raise FrontMatterError("SKILL.md 头部没有结束的 ---")


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        inner = v[1:-1]
        if v[0] == "'":
            return inner.replace("''", "'")
        return inner.replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")
    if " #" in v:
        v = v.split(" #", 1)[0].rstrip()
    return v


def parse(header: str) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    lines = header.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#") or line[:1] in (" ", "\t"):
            i += 1
            continue
        m = _KEY.match(line)
        if not m:
            i += 1
            continue
        key, rest = m.group(1), m.group(2).strip()
        block: list[str] = []
        j = i + 1
        while j < len(lines) and (not lines[j].strip() or lines[j][:1] in (" ", "\t")):
            block.append(lines[j])
            j += 1
        if rest in (">", "|", ">-", "|-", ">+", "|+"):
            stripped = [b.strip() for b in block]
            if rest.startswith(">"):
                value = " ".join(s for s in stripped if s)
            else:
                value = "\n".join(stripped).strip("\n")
            out[key] = value
        elif rest == "":
            out[key] = None if any(b.strip() for b in block) else ""
        else:
            value = _unquote(rest)
            # 未加引号的多行普通标量：续行折叠成空格
            cont = [b.strip() for b in block if b.strip()]
            if cont and rest[:1] not in "\"'[{":
                value = " ".join([value, *cont])
            out[key] = value
        i = j
    return out
