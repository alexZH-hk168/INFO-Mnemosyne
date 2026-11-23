"""上下文构造（任务第 1 条）：系统提示 + L4 画像 + 当前分支路径上的消息 + Skill 名称与简介。

路径一律经 app/branch/path.py 计算；记忆与 Skill 只经 app/agent/hooks.py 取。
"""

from __future__ import annotations

import sqlite3

from app.agent import hooks
from app.agent.text import MARKER_RE
from app.branch.path import path_to_root

MAX_HISTORY = 24
MAX_CHARS = 6000

SYSTEM_PROMPT = """你是 Mnemosyne，一个帮助用户读论文、代码和课件的学习助手。默认用中文回答；用户用其他语言提问时用那种语言。

回答规则：
1. 需要事实依据时先调用工具查找。工具返回的每段内容都带编号，例如 [[E1]]。
2. 某句话的内容来自某段证据时，在这句话的句末标点之前写上它的编号，例如“……方差是 dₖ[[E1]]。”。一句可以写多个编号。
3. 只能写本轮工具返回过的编号；不要编造编号，不要沿用之前回合的编号。
4. 没有证据支持、属于你自己的推理或常识的句子不要写编号。引用校验后只部分成立的句子会被标为“推断”。
5. 提到过去的对话时说“历史对话”。
6. 回答先给结论，再解释，简洁清楚。"""


def strip_for_context(text: str) -> str:
    return MARKER_RE.sub("", text or "")


def path_messages(conn: sqlite3.Connection, leaf_id: str) -> list[sqlite3.Row]:
    ids = list(reversed(path_to_root(conn, leaf_id)))
    if not ids:
        return []
    qs = ",".join("?" * len(ids))
    rows = {r["id"]: r for r in conn.execute(f"SELECT * FROM messages WHERE id IN ({qs})", ids)}
    return [rows[i] for i in ids if i in rows]


def system_prompt(conn: sqlite3.Connection, project_id: str, *, scope_mode: str, web_search: bool) -> str:
    parts = [SYSTEM_PROMPT]
    try:
        profile = hooks.get_memory().l4_profile(conn, project_id) or ""
    except Exception:  # noqa: BLE001 - 画像失败不影响回答
        profile = ""
    if profile.strip():
        parts.append("关于这位用户（由历史对话概括）：\n" + profile.strip())
    try:
        skills = hooks.get_skills().list_enabled(conn, project_id=project_id) or []
    except Exception:  # noqa: BLE001
        skills = []
    if skills:
        lines = [f"- {s.get('id') or s.get('name')}：{s.get('summary') or ''}" for s in skills]
        parts.append("可用的 Skill（需要时用 load_skill 读取全文后照做）：\n" + "\n".join(lines))
    if scope_mode == "none":
        parts.append("用户这一轮选择了不使用项目材料。")
    elif scope_mode == "selected":
        parts.append("用户这一轮只让你使用他指定的几份材料。")
    if not web_search:
        parts.append("这一轮没有开启联网检索。")
    return "\n\n".join(parts)


def build_messages(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    user_message_id: str,
    scope_mode: str,
    web_search: bool,
    forced_skill_text: str | None = None,
) -> list[dict]:
    msgs: list[dict] = [{"role": "system", "content": system_prompt(conn, project_id, scope_mode=scope_mode, web_search=web_search)}]
    history: list[dict] = []
    for r in path_messages(conn, user_message_id):
        content = strip_for_context(r["content"])[:MAX_CHARS]
        if r["role"] == "user":
            history.append({"role": "user", "content": content})
        elif r["role"] == "assistant":
            if content.strip():
                history.append({"role": "assistant", "content": content})
        elif r["role"] == "merge_note":
            history.append({"role": "system", "content": "（从分支合并回来的要点）\n" + content})
    history = history[-MAX_HISTORY:]
    while history and history[0]["role"] == "assistant":
        history.pop(0)
    if forced_skill_text:
        msgs.append({"role": "system", "content": "用户指定本轮使用下面这个 Skill：\n" + forced_skill_text[:MAX_CHARS]})
    return msgs + history
