"""OpenAI 兼容接口（/chat/completions）的适配：流式文本与工具调用、非流式补全。

只有 MN_LLM_BACKEND=openai 且 api_base、模型名、API Key 都配置了才会用到；单元测试不走这里。
"""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from app.llm.base import Chunk, ModelError, ToolCallReq

TIMEOUT = httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0)


class OpenAICompatModel:
    def __init__(self, api_base: str, api_key: str, transport: httpx.AsyncBaseTransport | None = None):
        self.api_base = api_base.rstrip("/")
        self.api_key = api_key
        self.transport = transport  # 测试注入 httpx.MockTransport，不访问网络

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=TIMEOUT, transport=self.transport) if self.transport else httpx.AsyncClient(timeout=TIMEOUT)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    async def stream(self, messages: list[dict], *, model: str, tools: list[dict] | None = None) -> AsyncIterator[Chunk]:
        body: dict = {"model": model, "messages": messages, "stream": True, "stream_options": {"include_usage": True}}
        if tools:
            body["tools"] = tools
        url = f"{self.api_base}/chat/completions"
        calls: dict[int, dict] = {}
        try:
            async with self._client() as client:
                async with client.stream("POST", url, headers=self._headers(), json=body) as resp:
                    if resp.status_code >= 400:
                        detail = (await resp.aread()).decode("utf-8", "replace")[:300]
                        raise ModelError(f"模型接口返回 {resp.status_code}：{detail}")
                    async for line in resp.aiter_lines():
                        line = line.strip()
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            data = json.loads(payload)
                        except ValueError:
                            continue
                        if data.get("usage"):
                            u = data["usage"]
                            yield Chunk(usage=(int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)))
                        for choice in data.get("choices") or []:
                            delta = choice.get("delta") or {}
                            if delta.get("content"):
                                yield Chunk(text=delta["content"])
                            for tc in delta.get("tool_calls") or []:
                                slot = calls.setdefault(int(tc.get("index", 0)), {"id": "", "name": "", "args": ""})
                                if tc.get("id"):
                                    slot["id"] = tc["id"]
                                fn = tc.get("function") or {}
                                if fn.get("name"):
                                    slot["name"] += fn["name"]
                                if fn.get("arguments"):
                                    slot["args"] += fn["arguments"]
        except httpx.HTTPError as e:
            raise ModelError(f"模型接口连接失败：{type(e).__name__}") from e
        if calls:
            out = []
            for idx in sorted(calls):
                slot = calls[idx]
                try:
                    args = json.loads(slot["args"]) if slot["args"].strip() else {}
                except ValueError:
                    args = {"_raw": slot["args"]}
                out.append(ToolCallReq(id=slot["id"] or f"call_{idx}", name=slot["name"], arguments=args if isinstance(args, dict) else {}))
            yield Chunk(tool_calls=out)

    async def complete(self, messages: list[dict], *, model: str) -> tuple[str, tuple[int, int]]:
        url = f"{self.api_base}/chat/completions"
        try:
            async with self._client() as client:
                resp = await client.post(url, headers=self._headers(), json={"model": model, "messages": messages})
        except httpx.HTTPError as e:
            raise ModelError(f"模型接口连接失败：{type(e).__name__}") from e
        if resp.status_code >= 400:
            raise ModelError(f"模型接口返回 {resp.status_code}：{resp.text[:300]}")
        try:
            data = resp.json()
            text = data["choices"][0]["message"].get("content") or ""
            u = data.get("usage") or {}
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise ModelError("模型接口响应格式不对") from e
        return text, (int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0))
