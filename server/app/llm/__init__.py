"""模型适配层入口：按设置返回假模型或 OpenAI 兼容模型。

切换真实模型：设 MN_LLM_BACKEND=openai，再在设置页（PUT /api/settings）或环境变量里给
api_base（MN_LLM_API_BASE）、chat_model（MN_LLM_MODEL）、small_model（MN_LLM_SMALL_MODEL）与 API Key（MN_LLM_API_KEY）。
"""

from __future__ import annotations

from app.llm.base import ChatModel, Chunk, ModelError, ToolCallReq, tool_schema
from app.llm.settings import LLMConfig, llm_config

__all__ = ["ChatModel", "Chunk", "ModelError", "ToolCallReq", "tool_schema", "LLMConfig", "llm_config", "get_model"]


def get_model(cfg: LLMConfig | None = None) -> ChatModel:
    cfg = cfg or llm_config()
    if cfg.backend == "fake":
        from app.llm.fake import FakeModel

        return FakeModel()
    if not cfg.configured:
        raise ModelError("模型接口不可用，请检查设置里的 API Key")
    from app.llm.openai_compat import OpenAICompatModel

    return OpenAICompatModel(cfg.api_base, cfg.api_key)
