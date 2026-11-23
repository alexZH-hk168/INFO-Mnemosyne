"""确定性假模型：开发与全部测试默认使用，不访问网络。

行为只依赖传进来的消息与工具清单（和真实模型同一套协议）：
- 一轮里还没有工具结果：按可用工具依次请求 search_materials、recall_memory、fetch_url（用户消息里有网址时）或 search_web；
  用户消息里写了某个插件工具的全名（`插件id__工具名`）时也调用它；全名后面紧跟一个 JSON 对象时把它当参数
  （[VER1] 真实插件验收用，例如 `arxiv__search_papers {"query": "attention"}`），否则参数为空。
- 有 search_web 结果但还没抓网页：抓第一条结果。
- 否则给出最终回答：按证据编号轮流写三种句子，覆盖引用校验的三种结果：
  原文照录（→ supported）、截取一半原文再加推断（→ partial）、与原文无关（→ removed，第二关词面重叠就会去掉）。
- 引用判定（complete 收到【引用判定】）：按回答句与证据的字符二元组重叠率给 supported / partial / removed。
- 对话标题（complete 收到【对话标题】）：取首条用户消息前 20 个字。
环境变量 MN_FAKE_LLM_DELAY_MS：每段正文之间的停顿（测试取消与续流用），默认 0。
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from typing import AsyncIterator

from app.agent.text import MARKER_RE, overlap
from app.llm.base import Chunk, ToolCallReq

URL_RE = re.compile(r"https?://[^\s<>\"'，。）)]+")
EVIDENCE_RE = re.compile(r"^\[\[(E\d+)\]\] 《(.*?)》\n(.*?)(?=\n\n\[\[E\d+\]\] 《|\Z)", re.S | re.M)
JUDGE_TAG = "【引用判定】"
TITLE_TAG = "【对话标题】"
TITLE_LEN = 20

SUPPORTED_MIN = 0.9
PARTIAL_MIN = 0.3
PARTIAL_FILLER = "这一点在材料里只有部分依据，需要结合上下文理解"


def _delay() -> float:
    try:
        return max(0.0, float(os.environ.get("MN_FAKE_LLM_DELAY_MS", "0")) / 1000.0)
    except ValueError:
        return 0.0


def _tokens(text: str) -> int:
    return max(1, len(text) // 2)


def fake_verdict(sentence: str, quote: str) -> str:
    ov = overlap(sentence, quote)
    if ov >= SUPPORTED_MIN:
        return "supported"
    if ov >= PARTIAL_MIN:
        return "partial"
    return "removed"


def _first_sentence(quote: str) -> str:
    q = " ".join(quote.split())
    m = re.search(r"(?<=[。！？!?])|(?<=\.)\s", q)
    if m and m.start() > 0:
        q = q[: m.start()]
    return q.rstrip("。.!?！？;；,，:： ")


def _clip(s: str, n: int) -> str:
    if len(s) <= n:
        return s
    cut = s[:n]
    sp = cut.rfind(" ")
    return cut[:sp] if sp >= n // 2 else cut


def chunk_text(text: str, size: int = 14) -> list[str]:
    """把正文切成小段（[[E#]] 标记不拆开）。"""
    parts: list[str] = []
    buf = ""
    pos = 0
    for m in MARKER_RE.finditer(text):
        plain = text[pos : m.start()]
        for ch in plain:
            buf += ch
            if len(buf) >= size or ch in "。\n":
                parts.append(buf)
                buf = ""
        buf += m.group(0)
        pos = m.end()
    for ch in text[pos:]:
        buf += ch
        if len(buf) >= size or ch in "。\n":
            parts.append(buf)
            buf = ""
    if buf:
        parts.append(buf)
    return parts


def build_answer(evidence: list[tuple[str, str, str]], question: str) -> str:
    """evidence: [(label, title, quote)]，按编号轮流写 supported / partial / removed 三种句子。"""
    if not evidence:
        q = question.strip().replace("\n", " ")
        return f"这一轮没有找到可以引用的材料。下面只凭一般知识回答“{_clip(q, 30)}”，没有来源支持，请结合原文核对。"
    lines = ["根据这一轮找到的材料，回答如下。"]
    for i, (label, _title, quote) in enumerate(evidence[:6]):
        first = _first_sentence(quote)
        kind = i % 3
        if kind == 0:
            lines.append(f"{_clip(first, 120)}[[{label}]]。")
        elif kind == 1:
            lines.append(f"{_clip(first, 40)}，{PARTIAL_FILLER}[[{label}]]。")
        else:
            lines.append(f"这部分内容和问题的关系还不清楚[[{label}]]。")
    lines.append("没有标注来源的句子是根据上面的材料作出的归纳。")
    return "\n\n".join(lines)


def plugin_args(question: str, name: str) -> dict:
    """[VER1] 工具全名后面紧跟的 JSON 对象（允许空白）当参数；没有或解析失败时返回 {}。"""
    i = question.find(name)
    rest = question[i + len(name):].lstrip()
    if not rest.startswith("{"):
        return {}
    try:
        obj, _ = json.JSONDecoder().raw_decode(rest)
    except ValueError:
        return {}
    return obj if isinstance(obj, dict) else {}


class FakeModel:
    def __init__(self) -> None:
        self.delay = _delay()

    async def stream(self, messages: list[dict], *, model: str, tools: list[dict] | None = None) -> AsyncIterator[Chunk]:
        prompt_tokens = sum(_tokens(str(m.get("content") or "")) for m in messages)
        names = {t["function"]["name"] for t in (tools or [])}
        last_user = max((i for i, m in enumerate(messages) if m["role"] == "user"), default=-1)
        question = str(messages[last_user]["content"]) if last_user >= 0 else ""
        after = messages[last_user + 1 :]
        done = {tc["function"]["name"] for m in after if m["role"] == "assistant" for tc in (m.get("tool_calls") or [])}
        calls = self._plan(question, names, done, after)
        if calls:
            if self.delay:
                await asyncio.sleep(self.delay)
            yield Chunk(tool_calls=calls)
            yield Chunk(usage=(prompt_tokens, 8 * len(calls)))
            return
        evidence: list[tuple[str, str, str]] = []
        seen: set[str] = set()
        for m in after:
            if m["role"] != "tool":
                continue
            for lab, title, quote in EVIDENCE_RE.findall(str(m.get("content") or "")):
                if lab not in seen:
                    seen.add(lab)
                    evidence.append((lab, title, quote.strip()))
        evidence.sort(key=lambda x: int(x[0][1:]))
        text = build_answer(evidence, question)
        for part in chunk_text(text):
            if self.delay:
                await asyncio.sleep(self.delay)
            yield Chunk(text=part)
        yield Chunk(usage=(prompt_tokens, _tokens(text)))

    def _plan(self, question: str, names: set[str], done: set[str], after: list[dict]) -> list[ToolCallReq]:
        calls: list[ToolCallReq] = []
        if not done:
            if "search_materials" in names:
                calls.append(ToolCallReq("call_1", "search_materials", {"query": question}))
            if "recall_memory" in names:
                calls.append(ToolCallReq("call_2", "recall_memory", {"query": question}))
            urls = URL_RE.findall(question)
            if urls and "fetch_url" in names:
                calls.append(ToolCallReq("call_3", "fetch_url", {"url": urls[0], "query": question}))
            elif "search_web" in names:
                calls.append(ToolCallReq("call_3", "search_web", {"query": question}))
            for n in sorted(names):
                if "__" in n and n in question:
                    calls.append(ToolCallReq(f"call_{len(calls) + 1}", n, plugin_args(question, n)))
            return calls
        if "search_web" in done and "fetch_url" not in done and "fetch_url" in names:
            id2name = {
                tc["id"]: tc["function"]["name"]
                for m in after
                if m["role"] == "assistant"
                for tc in (m.get("tool_calls") or [])
            }
            for m in after:
                if m["role"] == "tool" and id2name.get(m.get("tool_call_id")) == "search_web":
                    urls = URL_RE.findall(str(m.get("content") or ""))
                    if urls:
                        return [ToolCallReq("call_9", "fetch_url", {"url": urls[0], "query": question})]
        return []

    async def complete(self, messages: list[dict], *, model: str) -> tuple[str, tuple[int, int]]:
        prompt = "\n".join(str(m.get("content") or "") for m in messages)
        if JUDGE_TAG in prompt:
            m = re.search(r"```json\n(.*?)\n```", prompt, re.S)
            items = json.loads(m.group(1)) if m else []
            out = [{"i": it["i"], "verdict": fake_verdict(it["sentence"], it["quote"])} for it in items]
            text = json.dumps(out, ensure_ascii=False)
        elif TITLE_TAG in prompt:
            m = re.search(r"<question>\n?(.*?)\n?</question>", prompt, re.S)
            q = " ".join((m.group(1) if m else "").split())
            text = q[:TITLE_LEN]
        else:
            text = "好的。"
        return text, (_tokens(prompt), _tokens(text))
