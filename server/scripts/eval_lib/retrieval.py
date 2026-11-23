"""B2（朴素 RAG）与桩适配器用的检索：嵌入 + 余弦相似度取前 k。

- `hash`：本地确定性哈希词袋嵌入（只用于开发与测试，相当于词面匹配，不代表语义检索效果）。
- `openai:<模型名>`：OpenAI 兼容 /embeddings（付费，受 MN_EVAL_ALLOW_PAID 闸门约束）。
真跑时 B2 应与 M 用同一个嵌入模型，保证对照公平（由 U2 定模型后填）。
"""

from __future__ import annotations

import hashlib
import math
import os
import re
from collections import Counter
from typing import Protocol

import httpx

from .common import normalize_text
from .llm import PaidCallBlocked

_WORD = re.compile(r"\w+", re.UNICODE)


class Embedder(Protocol):
    name: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashEmbedder:
    def __init__(self, dim: int = 512):
        self.dim = dim
        self.name = f"hash-{dim}"

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for tok, n in Counter(_WORD.findall(normalize_text(text))).items():
            h = int.from_bytes(hashlib.blake2b(tok.encode("utf-8"), digest_size=8).digest(), "big")
            vec[h % self.dim] += (1.0 if (h >> 63) & 1 else -1.0) * math.sqrt(n)
        norm = math.sqrt(sum(v * v for v in vec))
        return [v / norm for v in vec] if norm else vec

    def embed(self, texts):
        return [self._one(t) for t in texts]


class OpenAICompatEmbedder:
    batch_size = 64

    def __init__(self, model: str, *, transport: httpx.BaseTransport | None = None):
        if os.environ.get("MN_EVAL_ALLOW_PAID") != "1":
            raise PaidCallBlocked(f"嵌入模型 {model} 会产生付费调用；用户确认预算后设 MN_EVAL_ALLOW_PAID=1。")
        self.model = model
        self.name = model
        self.api_base = (os.environ.get("MN_EVAL_API_BASE") or "https://api.openai.com/v1").rstrip("/")
        self._key = os.environ.get("MN_EVAL_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
        self.transport = transport

    def embed(self, texts):
        out: list[list[float]] = []
        headers = {"Authorization": f"Bearer {self._key}"} if self._key else {}
        with httpx.Client(timeout=120.0, transport=self.transport) as c:
            for i in range(0, len(texts), self.batch_size):
                r = c.post(f"{self.api_base}/embeddings", json={"model": self.model, "input": texts[i : i + self.batch_size]}, headers=headers)
                if r.status_code >= 400:
                    raise RuntimeError(f"embeddings 返回 HTTP {r.status_code}")
                out.extend(d["embedding"] for d in sorted(r.json()["data"], key=lambda d: d["index"]))
        return out


def make_embedder(spec: str) -> Embedder:
    if spec == "hash":
        return HashEmbedder()
    if spec.startswith("openai:"):
        return OpenAICompatEmbedder(spec.split(":", 1)[1])
    raise ValueError(f"未知嵌入器：{spec}（可选 hash、openai:<模型名>）")


def cosine(a: list[float], b: list[float]) -> float:
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if not na or not nb:
        return 0.0
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def top_k(query: str, docs: list[str], embedder: Embedder, k: int) -> list[tuple[int, float]]:
    """返回 [(文档下标, 分数)]，分数降序；同分按下标升序，保证确定。"""
    if not docs:
        return []
    vecs = embedder.embed([query] + docs)
    q, dv = vecs[0], vecs[1:]
    scored = [(i, round(cosine(q, v), 6)) for i, v in enumerate(dv)]
    scored.sort(key=lambda t: (-t[1], t[0]))
    return scored[:k]
