"""模型适配层的公共类型。Agent 只依赖这里的 ChatModel 接口；具体实现见 openai_compat.py（真实接口）与 fake.py（测试用）。

消息格式沿用 OpenAI Chat Completions：{"role": system|user|assistant|tool, "content", "tool_calls"?, "tool_call_id"?}。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol


class ModelError(Exception):
    """模型接口不可用（网络、鉴权、配置缺失、响应格式不对）。对应错误码 MODEL_UNAVAILABLE。"""


@dataclass
class ToolCallReq:
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass
class Chunk:
    """流式输出的一个单元：text、tool_calls、usage 三者之一。"""

    text: str | None = None
    tool_calls: list[ToolCallReq] | None = None
    usage: tuple[int, int] | None = None  # (prompt_tokens, completion_tokens)


class ChatModel(Protocol):
    def stream(
        self, messages: list[dict], *, model: str, tools: list[dict] | None = None
    ) -> AsyncIterator[Chunk]: ...

    async def complete(self, messages: list[dict], *, model: str) -> tuple[str, tuple[int, int]]: ...


def tool_schema(name: str, description: str, parameters: dict) -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": parameters}}
