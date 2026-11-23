"""模型适配：假模型（测试用，确定、不联网）与 OpenAI 兼容聊天接口（付费，有闸门）。

付费闸门：构造 OpenAICompatChat 时必须设环境变量 MN_EVAL_ALLOW_PAID=1，否则抛 PaidCallBlocked。
这是为了守住硬约束「先在 dev-120 跑 M 的前 10 题报成本，用户确认预算后再扩大」（未决 U2）。
密钥先读环境变量（MN_EVAL_API_KEY，退回 OPENAI_API_KEY），都没有时读用户在设置页保存的 settings.json（BYOK，
与对话、记忆同一份）；不写日志、不进错误信息。
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Callable, Protocol

import httpx

from .common import normalize_text


class PaidCallBlocked(RuntimeError):
    pass


@dataclass
class ChatResult:
    text: str
    tokens_in: int
    tokens_out: int
    latency_ms: int
    cost_usd: float | None


class ChatModel(Protocol):
    name: str

    def complete(self, messages: list[dict[str, str]], *, max_tokens: int = 512, temperature: float = 0.0) -> ChatResult: ...


def approx_tokens(text: str) -> int:
    """假模型用的粗略 token 数（约 4 字符 1 token）；真实模型以接口返回的 usage 为准。"""
    return len(text) // 4 + 1


@dataclass
class Pricing:
    """每百万 token 的美元单价；由用户按所选模型的官方价目填写，未填时 cost_usd 记 null。"""

    in_per_m: float | None = None
    out_per_m: float | None = None

    def cost(self, tin: int, tout: int) -> float | None:
        if self.in_per_m is None or self.out_per_m is None:
            return None
        return round(tin * self.in_per_m / 1e6 + tout * self.out_per_m / 1e6, 8)


class FakeChat:
    """确定性假模型：responder(messages) → 文本；token 按字符数估算，latency 记 0。"""

    def __init__(self, responder: Callable[[list[dict[str, str]]], str], name: str = "fake", pricing: Pricing | None = None):
        self.responder = responder
        self.name = name
        self.pricing = pricing or Pricing()
        self.calls: list[list[dict[str, str]]] = []

    def complete(self, messages, *, max_tokens=512, temperature=0.0):
        self.calls.append(messages)
        text = self.responder(messages)
        tin = sum(approx_tokens(m["content"]) for m in messages)
        tout = approx_tokens(text)
        return ChatResult(text=text, tokens_in=tin, tokens_out=tout, latency_ms=0, cost_usd=self.pricing.cost(tin, tout))


_WORD = re.compile(r"\w+", re.UNICODE)
_STOP = {
    "the", "a", "an", "i", "my", "me", "you", "your", "did", "do", "does", "what", "which", "how", "is", "was",
    "of", "to", "in", "for", "on", "and", "or", "it", "that", "with", "at", "be", "are", "were", "have", "has",
    "many", "much", "when", "where", "who", "now", "currently", "can",
}


def _content_words(text: str) -> set[str]:
    return {w for w in _WORD.findall(normalize_text(text)) if w not in _STOP}


# 日期本身带括号（如 "2023/05/30 (Tue) 23:40"），所以用非贪婪匹配回溯到 ") role:" 处
_CTX_LINE = re.compile(r"^(?:\[(?P<n>\d+)\]\s*)?\((?P<date>.*?)\)\s*(?P<role>user|assistant):\s*(?P<content>.*)$")


def extractive_responder(messages: list[dict[str, str]]) -> str:
    """假读者：在提示里的上下文行（格式见 systems.format_turn_line）中找与问题词重合最多的一行，
    原样返回该行内容；行带编号 [n] 时在末尾加引用 [n]；一行都不重合时回答 "I don't know."。
    只为让流水线在测试里跑通，不代表任何真实模型的能力。"""
    prompt = messages[-1]["content"]
    q = ""
    for line in prompt.splitlines():
        if line.startswith("Question:"):
            q = line[len("Question:") :]
    qw = _content_words(q)
    best, best_score = None, 0
    for line in prompt.splitlines():
        m = _CTX_LINE.match(line.strip())
        if not m:
            continue
        score = len(qw & _content_words(m.group("content")))
        if score > best_score:
            best, best_score = m, score
    if best is None:
        return "I don't know."
    ans = best.group("content").strip()
    if best.group("n"):
        ans += f" [{best.group('n')}]"
    return ans


def fake_judge_responder(messages: list[dict[str, str]]) -> str:
    """假判分器：读官方提示里的 Correct Answer/Rubric/Explanation 与 Model Response；
    普通题：归一化后的答案作为短语出现在回答里 → yes；拒答题：回答像拒答 → yes。"""
    from .common import contains_phrase, looks_like_abstention

    p = messages[-1]["content"]

    def field(name: str) -> str:
        m = re.search(rf"\n\n{name}: (.*?)\n\n", p, re.DOTALL)
        return m.group(1) if m else ""

    response = field("Model Response")
    if "unanswerable question" in p:
        return "yes" if looks_like_abstention(response) else "no"
    gold = field("Correct Answer") or field("Rubric")
    return "yes" if contains_phrase(response, gold) else "no"


def user_llm_settings() -> tuple[str, str]:
    """BYOK：用户在设置页保存的 (api_base, api_key)；读不到时返回空串。只在后端内部用，不打印。"""
    import sys
    from pathlib import Path

    server_dir = Path(__file__).resolve().parents[2]
    if str(server_dir) not in sys.path:
        sys.path.insert(0, str(server_dir))
    try:
        from app.llm.settings import _read_raw

        raw = _read_raw()
    except Exception:  # noqa: BLE001 - 评测脚本不因读不到设置而失败
        return "", ""
    base = raw.get("api_base") if isinstance(raw.get("api_base"), str) else ""
    key = raw.get("api_key") if isinstance(raw.get("api_key"), str) else ""
    return base.strip(), key.strip()


class OpenAICompatChat:
    """POST {base}/chat/completions。transport 可注入 httpx.MockTransport 做无网测试。"""

    def __init__(
        self,
        model: str,
        *,
        api_base: str | None = None,
        api_key: str | None = None,
        pricing: Pricing | None = None,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
        max_retries: int = 4,
    ):
        if os.environ.get("MN_EVAL_ALLOW_PAID") != "1":
            raise PaidCallBlocked(
                f"模型 {model} 会产生付费调用。按硬约束先用 --max-items 10 在 dev-120 上报成本、等用户确认预算；"
                "确认后设置环境变量 MN_EVAL_ALLOW_PAID=1 再运行。"
            )
        self.name = model
        self.model = model
        user_base, user_key = user_llm_settings()
        self.api_base = (api_base or os.environ.get("MN_EVAL_API_BASE") or user_base or "https://api.openai.com/v1").rstrip("/")
        self._key = api_key if api_key is not None else (os.environ.get("MN_EVAL_API_KEY") or os.environ.get("OPENAI_API_KEY") or user_key or "")
        self.pricing = pricing or Pricing()
        self.timeout = timeout
        self.transport = transport
        self.max_retries = max_retries

    def complete(self, messages, *, max_tokens=512, temperature=0.0):
        headers = {"Content-Type": "application/json"}
        if self._key:
            headers["Authorization"] = f"Bearer {self._key}"
        body = {"model": self.model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "n": 1}
        t0 = time.monotonic()
        delay = 2.0
        with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
            for attempt in range(self.max_retries + 1):
                resp = client.post(f"{self.api_base}/chat/completions", json=body, headers=headers)
                if resp.status_code in (429, 500, 502, 503, 504) and attempt < self.max_retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
                if resp.status_code >= 400:
                    raise RuntimeError(f"chat/completions 返回 HTTP {resp.status_code}")
                break
        data = resp.json()
        text = (data["choices"][0]["message"].get("content") or "").strip()
        usage = data.get("usage") or {}
        tin = int(usage.get("prompt_tokens", 0))
        tout = int(usage.get("completion_tokens", 0))
        return ChatResult(
            text=text,
            tokens_in=tin,
            tokens_out=tout,
            latency_ms=int((time.monotonic() - t0) * 1000),
            cost_usd=self.pricing.cost(tin, tout),
        )


def make_chat(spec: str, *, role: str = "reader", pricing: Pricing | None = None) -> ChatModel:
    """spec：`fake` → 假模型（reader 用抽取式，judge 用假判分）；其他 → OpenAI 兼容接口的模型名。"""
    if spec == "fake":
        return FakeChat(fake_judge_responder if role == "judge" else extractive_responder, name="fake", pricing=pricing)
    return OpenAICompatChat(spec, pricing=pricing)
