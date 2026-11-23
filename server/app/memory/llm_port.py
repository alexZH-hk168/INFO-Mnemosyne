"""记忆子系统用到的全部“模型判断”都经过这里：抽取候选、ADD/UPDATE/SUPERSEDE/NOOP 判定、L2/L4 重写、分支合并要点。

默认是**确定性假实现**（规则式），不访问网络、不发起任何付费调用；开发与测试都用它。
接口：`complete_json(task, prompt, data=...) -> dict`。`prompt` 是给真实模型的完整提示词（已按任务拼好），
`data` 是同一份输入的结构化形式，假实现只读 `data`。

INT1 已接上：配置了真实模型（MN_LLM_BACKEND=openai 且 api_base/small_model/API Key 齐全）时调用 `app.llm` 的小模型，
`prompt` 原样发出、解析 JSON；解析失败或模型不可用时退回本文件的规则实现。默认是假模型，不发起付费调用；
用户定下模型与预算（未决 U2）之前不要打开真实模型。

任务与返回结构：
- extract  data={user, assistant, user_message_id, assistant_message_id}
           → {"candidates": [{type, topic, content, source_msg_ids, confidence}]}
           type ∈ knowledge | misconception | progress | preference
- judge    data={candidate, existing: [{id, topic, content}]}（existing 为同主题前 5 条）
           → {"action": "ADD"|"UPDATE"|"SUPERSEDE"|"NOOP", "target_id"?: str, "content"?: str}
- digest   data={previous, turns: [{user, assistant}], max_chars} → {"content"}
- profile  data={preferences: [...], items: [{topic, content}], max_tokens} → {"content"}
- merge    data={title, anchor_quote, turns: [{user, assistant}]} → {"content"}
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.ingest.tokenize import count_tokens

_MARKER = re.compile(r"\[\[E\d+\]\]")

# 偏好类表述。group "neg" 表示否定（不喜欢 / 不再喜欢）。
_PREF_PATTERNS = [
    re.compile(r"(?:我|自己)?(?:现在|目前|后来|其实)?(?:改成|改为|变成|换成)?(?:更)?(?P<verb>喜欢|偏好|偏爱|爱用|习惯用?)\s*(?P<obj>[^，。！？,.!?；;\n]{1,40})"),
    re.compile(r"(?:I|i)\s+(?:now\s+|actually\s+)?(?P<verb>prefer|like|love)\s+(?P<obj>[^,.!?;\n]{1,60})"),
]
_PREF_NEG = re.compile(r"(?:不再|不|没那么|已经不)(?:喜欢|偏好|爱用)\s*(?P<obj>[^，。！？,.!?；;\n]{1,40})")
_ANSWER_STYLE = re.compile(r"(?:希望|请|以后|麻烦)(?:你)?(?:回答|讲解|解释)?(?:时)?(?P<obj>先[^，。！？\n]{1,40}(?:[，,][^，。！？\n]{1,30})?)")
_CHANGE_MARKERS = ("改成", "改为", "变成", "换成", "现在", "目前", "后来", "不再", "其实", "不喜欢", "已经不", "instead", "now", "actually", "no longer")
_PAST_WORDS = ("以前", "之前", "曾经", "原来", "过去", "used to")
_QUESTION = re.compile(r"什么|哪|吗|么|\?|？|what|which", re.I)
_MISCONCEPTION = re.compile(r"(?:我以为|我原来以为|我一直以为|原来不是|搞错了?|理解错了?|卡在)(?P<obj>[^。！？\n]{2,60})")
_PROGRESS = re.compile(r"(?:我)?(?:已经|终于)?(?:学完了?|看完了?|理解了|懂了|搞懂了?|弄懂了?|完成了?)(?P<obj>[^。！？\n]{0,40})")
_KNOWLEDGE = re.compile(r"(?:记住|请记住|帮我记一下|记一下)[：:，,\s]*(?P<obj>[^。！？\n]{2,80})")


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", _MARKER.sub("", text or "")).strip()


def _join(prefix: str, obj: str) -> str:
    """中文前缀接拉丁词时留一个空格：“用户喜欢 Python”。"""
    return f"{prefix} {obj}" if obj[:1].isascii() and obj[:1].isalnum() else f"{prefix}{obj}"


def _strip_obj(obj: str) -> str:
    obj = obj.strip().strip("“”\"'「」 ")
    obj = re.sub(r"(了|啦|的了|吧|呢)$", "", obj).strip()
    return obj


# ---------- extract ----------

def _extract(data: dict) -> dict:
    user = _clean(data.get("user", ""))
    src = [x for x in (data.get("user_message_id"),) if x]
    out: list[dict] = []
    has_change = any(k in user for k in _CHANGE_MARKERS)

    pref_obj = None
    neg = _PREF_NEG.search(user)
    for pat in _PREF_PATTERNS:
        for mm in pat.finditer(user):
            start = mm.start("verb")
            # “不喜欢 X”不算正向偏好
            before = user[max(0, start - 4) : start]
            if before.endswith(("不", "不再", "已经不")):
                continue
            if any(w in before for w in _PAST_WORDS):  # “以前喜欢”说的是过去，不是当前偏好
                continue
            obj = _strip_obj(mm.group("obj"))
            if not obj or _QUESTION.search(obj):  # “我喜欢什么？”是提问
                continue
            pref_obj = obj
        if pref_obj:
            break
    if pref_obj:
        out.append({"type": "preference", "topic": "偏好", "content": _join("用户喜欢", pref_obj), "source_msg_ids": src,
                    "confidence": 0.8, "change": has_change})
    elif neg:
        out.append({"type": "preference", "topic": "偏好", "content": _join("用户不喜欢", _strip_obj(neg.group("obj"))),
                    "source_msg_ids": src, "confidence": 0.7, "change": True})

    style = _ANSWER_STYLE.search(user)
    if style:
        out.append({"type": "preference", "topic": "回答偏好", "content": f"希望回答{_strip_obj(style.group('obj'))}",
                    "source_msg_ids": src, "confidence": 0.7, "change": has_change})
    mis = _MISCONCEPTION.search(user)
    if mis:
        out.append({"type": "misconception", "topic": "易错点", "content": f"曾误解：{_strip_obj(mis.group('obj'))}",
                    "source_msg_ids": src, "confidence": 0.6, "change": False})
    prog = _PROGRESS.search(user)
    if prog and not mis:
        what = _strip_obj(prog.group("obj")) or "当前内容"
        out.append({"type": "progress", "topic": "学习进度", "content": f"已掌握：{what}", "source_msg_ids": src,
                    "confidence": 0.6, "change": False})
    know = _KNOWLEDGE.search(user)
    if know:
        out.append({"type": "knowledge", "topic": "知识点", "content": _strip_obj(know.group("obj")), "source_msg_ids": src,
                    "confidence": 0.7, "change": False})
    return {"candidates": out}


# ---------- judge ----------

def _norm(s: str) -> str:
    return re.sub(r"[\s，。,.!！?？]", "", s or "").lower()


def _judge(data: dict) -> dict:
    cand = data["candidate"]
    existing = data.get("existing") or []
    c = _norm(cand["content"])
    for e in existing:
        if _norm(e["content"]) == c:
            return {"action": "NOOP", "target_id": e["id"]}
    for e in existing:
        en = _norm(e["content"])
        if c and en and (c in en or en in c):  # 同一件事说得更完整/更短 → 合并为更长的一条
            return {"action": "UPDATE", "target_id": e["id"], "content": cand["content"] if len(c) >= len(en) else e["content"]}
    if existing and cand.get("type") == "preference" and cand.get("change"):
        # 偏好发生变化：替换同主题最新的一条，旧条目保留为历史版本
        return {"action": "SUPERSEDE", "target_id": existing[0]["id"]}
    return {"action": "ADD"}


# ---------- digest / profile / merge ----------

def _first_sentence(text: str, limit: int = 80) -> str:
    t = _clean(text)
    m = re.match(r"(.+?[。！？!?.])(\s|$)", t)
    s = m.group(1) if m else t
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _digest(data: dict) -> dict:
    lines = [ln for ln in (data.get("previous") or "").splitlines() if ln.strip()]
    for t in data.get("turns") or []:
        lines.append(f"- 问：{_first_sentence(t.get('user', ''), 60)} 答：{_first_sentence(t.get('assistant', ''), 80)}")
    max_chars = int(data.get("max_chars") or 1200)
    while len("\n".join(lines)) > max_chars and len(lines) > 1:
        lines.pop(0)  # 超长时丢最早的要点（规则式“重写”）
    return {"content": "\n".join(lines)}


def _profile(data: dict) -> dict:
    parts: list[str] = []
    prefs = data.get("preferences") or []
    items = data.get("items") or []
    if prefs:
        parts.append("讲解偏好：" + "；".join(prefs) + "。")
    if items:
        parts.append("近期学习：" + "；".join(f"{i['topic']}：{i['content']}" for i in items) + "。")
    topics = sorted({i["topic"] for i in items} | ({"偏好"} if prefs else set()))
    if topics:
        parts.append("主题索引：" + "、".join(topics) + "（详见 L3 主题记忆）。")
    content = "\n".join(parts)
    max_tokens = int(data.get("max_tokens") or 800)
    while count_tokens(content) > max_tokens and len(content) > 20:
        content = content[: int(len(content) * 0.9)] + "…"
    return {"content": content}


def _merge(data: dict) -> dict:
    points = [_first_sentence(t.get("assistant", ""), 100) for t in data.get("turns") or [] if t.get("assistant")]
    title = data.get("title") or data.get("anchor_quote") or "分支"
    body = " ".join(points) if points else "（分支内暂无回答）"
    return {"content": f"分支「{title}」要点：{body}"}


_FAKE = {"extract": _extract, "judge": _judge, "digest": _digest, "profile": _profile, "merge": _merge}


# 每个任务的真实模型输出至少要有的键；缺了就退回规则实现
_REQUIRED = {"extract": "candidates", "judge": "action", "digest": "content", "profile": "content", "merge": "content"}
_JSON_ONLY = "\n只输出一个 JSON 对象，不要输出其他文字。"


def _parse_json(text: str) -> dict | None:
    t = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    if not t.startswith("{"):
        i, j = t.find("{"), t.rfind("}")
        if i < 0 or j <= i:
            return None
        t = t[i : j + 1]
    try:
        out = json.loads(t)
    except ValueError:
        return None
    return out if isinstance(out, dict) else None


def _valid(task: str, out: dict) -> bool:
    key = _REQUIRED[task]
    if key not in out:
        return False
    if task == "extract":
        return isinstance(out["candidates"], list) and all(isinstance(c, dict) for c in out["candidates"])
    if task == "judge":
        return out["action"] in ("ADD", "UPDATE", "SUPERSEDE", "NOOP")
    return isinstance(out[key], str)


def _real_model():
    """配置了真实模型（MN_LLM_BACKEND=openai 且 API Key 等齐全）时返回 (模型, 小模型名)，否则 None。"""
    from app.llm import ModelError, get_model, llm_config

    cfg = llm_config()
    if cfg.backend == "fake" or not cfg.configured:
        return None
    try:
        return get_model(cfg), cfg.small_model
    except ModelError:
        return None


def _call_real(task: str, prompt: str) -> dict | None:
    import asyncio

    from app.llm import ModelError

    real = _real_model()
    if real is None:
        return None
    try:
        asyncio.get_running_loop()
        return None  # 在事件循环线程里不能同步等待；调用方都在线程池或 jobs 线程里，这里只是兜底
    except RuntimeError:
        pass
    model, small = real
    try:
        text, _usage = asyncio.run(model.complete([{"role": "user", "content": prompt + _JSON_ONLY}], model=small))
    except Exception as e:  # noqa: BLE001 - 任何模型侧失败都退回规则实现，记忆任务不能因此失败
        if not isinstance(e, ModelError):
            logging.getLogger("mnemosyne.memory").warning("记忆任务 %s 调用真实模型失败：%s", task, type(e).__name__)
        return None
    out = _parse_json(text)
    return out if out is not None and _valid(task, out) else None


def complete_json(task: str, prompt: str, *, data: dict[str, Any] | None = None) -> dict:
    """返回模型输出的 JSON 对象。

    配置了真实模型（`app.llm`：MN_LLM_BACKEND=openai 且已配置）时把 `prompt` 发给小模型并解析 JSON；
    模型不可用、输出不是 JSON 或缺必需键时退回确定性规则实现。默认（假模型）不访问网络、不产生费用。（INT1）
    """
    if task not in _FAKE:
        raise ValueError(f"未知的记忆任务：{task}")
    out = _call_real(task, prompt)
    if out is not None:
        return out
    return _FAKE[task](data if data is not None else json.loads(prompt))


def build_prompt(task: str, data: dict[str, Any]) -> str:
    """给真实模型的提示词（假实现不读）。保持简短：任务说明 + JSON 输入 + 输出格式。"""
    instructions = {
        "extract": "从这一轮问答中抽取值得长期记住的候选：knowledge（学到的知识）、misconception（易错点）、progress（学习进度）、"
        "preference（偏好）。只抽用户明确表达或被证实的内容。输出 {\"candidates\":[{type,topic,content,source_msg_ids,confidence}]}。",
        "judge": "把候选与同主题已有条目比对：重复→NOOP；补充同一事实→UPDATE（给出合并后的 content）；"
        "事实或偏好变了→SUPERSEDE（target_id 为被替换条目）；新事实→ADD。输出 {action,target_id?,content?}。",
        "digest": "在上一版摘要基础上并入新一轮问答，保留关键事实，超过 max_chars 时压缩最早的内容。输出 {content}。",
        "profile": "把偏好与学习条目重写为不超过 max_tokens 的学习画像：学习目标、讲解偏好、主题索引。输出 {content}。",
        "merge": "总结这个分支的结论与依据，写成一段要合并回主线的要点，开头写“分支「标题」要点：”。输出 {content}。",
    }[task]
    return instructions + "\n输入：\n" + json.dumps(data, ensure_ascii=False)
