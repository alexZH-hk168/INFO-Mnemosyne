"""嵌入适配层。

- FakeEmbedder：对 fts_tokens 的每个词做 blake2b 哈希，投影到固定维度（带符号、按词频开方加权），再做 L2 归一化。
  完全确定、本地计算，词面相同的文本向量相近；只用于开发与测试，不代表语义检索效果。
- OpenAICompatEmbedder：POST {MN_EMBED_API_BASE}/embeddings，请求体 {model, input: [...]}，按 64 条一批。
  密钥只从环境变量读取，不写日志、不进错误信息。
"""

from __future__ import annotations

import hashlib
import math
from collections import Counter
from typing import Protocol

import httpx

from app.config import Config, get_config
from app.ingest.tokenize import fts_tokens


class EmbeddingError(RuntimeError):
    pass


class Embedder(Protocol):
    dim: int
    name: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class FakeEmbedder:
    def __init__(self, dim: int = 256):
        self.dim = dim
        self.name = f"fake-hash-{dim}"

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for tok, n in Counter(fts_tokens(text)).items():
            h = int.from_bytes(hashlib.blake2b(tok.encode("utf-8"), digest_size=8).digest(), "big")
            idx = h % self.dim
            sign = 1.0 if (h >> 63) & 1 else -1.0
            vec[idx] += sign * math.sqrt(n)
        norm = math.sqrt(sum(v * v for v in vec))
        if norm == 0:
            vec[0] = 1.0  # 空文本给一个固定方向，避免零向量
            return vec
        return [v / norm for v in vec]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]


class OpenAICompatEmbedder:
    batch_size = 64

    def __init__(self, api_base: str, model: str, api_key: str, dim: int, timeout: float = 60.0, transport: httpx.BaseTransport | None = None):
        if not api_base or not model or dim <= 0:
            raise EmbeddingError("真实嵌入模型未配置完整：需要 MN_EMBED_API_BASE、MN_EMBED_MODEL、MN_EMBED_DIM")
        self.api_base = api_base
        self.model = model
        self.api_key = api_key
        self.dim = dim
        self.name = model
        self.timeout = timeout
        self.transport = transport  # 测试注入 httpx.MockTransport，不访问网络

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
            for i in range(0, len(texts), self.batch_size):
                batch = texts[i : i + self.batch_size]
                try:
                    resp = client.post(
                        f"{self.api_base}/embeddings",
                        json={"model": self.model, "input": batch},
                        headers=headers,
                    )
                except httpx.HTTPError as e:
                    raise EmbeddingError(f"嵌入接口连接失败：{type(e).__name__}") from e
                if resp.status_code != 200:
                    raise EmbeddingError(f"嵌入接口返回 HTTP {resp.status_code}")
                data = sorted(resp.json().get("data", []), key=lambda d: d.get("index", 0))
                if len(data) != len(batch):
                    raise EmbeddingError("嵌入接口返回条数与请求不一致")
                for d in data:
                    vec = d["embedding"]
                    if len(vec) != self.dim:
                        raise EmbeddingError(f"嵌入维度 {len(vec)} 与 MN_EMBED_DIM={self.dim} 不一致")
                    out.append([float(x) for x in vec])
        return out


def get_embedder(config: Config | None = None) -> Embedder:
    config = config or get_config()
    if config.embed_backend == "fake":
        return FakeEmbedder(config.embed_dim or 256)
    if config.embed_backend == "openai":
        return OpenAICompatEmbedder(config.embed_api_base, config.embed_model, config.embed_api_key, config.embed_dim)
    raise EmbeddingError(f"未知的 MN_EMBED_BACKEND：{config.embed_backend}")
