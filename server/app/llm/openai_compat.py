"""OpenAI 兼容接口（/chat/completions）的适配：流式文本与工具调用、非流式补全。

BYOK：设置里 api_base、API Key、对话模型齐全时自动使用（见 settings.py）；单元测试用 httpx.MockTransport 注入，不访问网络。
出错时抛 ModelError，reason 与中文提示见 errors.py；提示里不含密钥、不含上游响应原文（400/422 只附脱敏摘要）。
"""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from app.llm import errors as E
from app.llm.base import Chunk, ModelError, ToolCallReq

TIMEOUT = httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0)


class OpenAICompatModel:
    def __init__(
        self,
        api_base: str,
        api_key: str,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        extra_body: dict | None = None,
        tool_extra: dict | None = None,
        timeout: httpx.Timeout | None = None,
    ):
        self.api_base = api_base.rstrip("/")
        self.api_key = api_key
        self.transport = transport  # 测试注入 httpx.MockTransport，不访问网络
        self.extra_body = dict(extra_body or {})
        self.tool_extra = dict(tool_extra or {})
        self.timeout = timeout or TIMEOUT

    def __repr__(self) -> str:  # 不让密钥出现在 repr / 日志里
        return f"OpenAICompatModel(api_base={self.api_base!r})"

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout, transport=self.transport) if self.transport else httpx.AsyncClient(timeout=self.timeout)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _body(self, model: str, messages: list[dict], tools: list[dict] | None) -> dict:
        body: dict = {"model": model, "messages": messages}
        body.update(self.extra_body)
        if tools:
            body["tools"] = tools
            body.update(self.tool_extra.get(model, {}))
        return body

    def _http_error(self, status: int, text: str) -> ModelError:
        reason = E.classify_status(status, text)
        detail = E.upstream_summary(text, self.api_key) if reason == "bad_request" else ""
        return ModelError(E.message_for(reason, status=status, detail=detail), reason=reason, retriable=E.retriable(reason))

    def _exc_error(self, e: BaseException) -> ModelError:
        reason = E.classify_exception(e)
        return ModelError(E.message_for(reason), reason=reason, retriable=E.retriable(reason))

    async def stream(self, messages: list[dict], *, model: str, tools: list[dict] | None = None) -> AsyncIterator[Chunk]:
        body = self._body(model, messages, tools)
        body["stream"] = True
        body["stream_options"] = {"include_usage": True}
        url = f"{self.api_base}/chat/completions"
        calls: dict[int, dict] = {}
        try:
            async with self._client() as client:
                async with client.stream("POST", url, headers=self._headers(), json=body) as resp:
                    if resp.status_code >= 400:
                        text = (await resp.aread()).decode("utf-8", "replace")
                        raise self._http_error(resp.status_code, text)
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
                        if isinstance(data.get("error"), dict):
                            # 流式中途出错（OpenRouter 等：HTTP 已是 200，错误放在 SSE data 里）
                            reason = E.classify_stream_error(data["error"])
                            raise ModelError(E.message_for(reason), reason=reason, retriable=E.retriable(reason))
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
            raise self._exc_error(e) from None
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
                resp = await client.post(url, headers=self._headers(), json=self._body(model, messages, None))
        except httpx.HTTPError as e:
            raise self._exc_error(e) from None
        if resp.status_code >= 400:
            raise self._http_error(resp.status_code, resp.text)
        try:
            data = resp.json()
            if isinstance(data.get("error"), dict):
                reason = E.classify_stream_error(data["error"])
                raise ModelError(E.message_for(reason), reason=reason, retriable=E.retriable(reason))
            text = data["choices"][0]["message"].get("content") or ""
            u = data.get("usage") or {}
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            raise ModelError(E.message_for("bad_response"), reason="bad_response", retriable=True) from None
        return text, (int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0))
