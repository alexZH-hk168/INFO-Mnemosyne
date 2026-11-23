"""模型适配层入口：按设置返回假模型或 OpenAI 兼容模型。

BYOK：用户在设置页（PUT /api/settings）保存了 api_base、API Key、对话模型后自动使用真实模型，
未配置时用假模型（界面标“演示模式”）。MN_LLM_BACKEND=fake 强制假模型，=openai 强制真实模型（见 settings.py）。
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
        from app.llm.errors import message_for

        raise ModelError(message_for("not_configured"), reason="not_configured", retriable=True)
    from app.llm.openai_compat import OpenAICompatModel

    return OpenAICompatModel(cfg.api_base, cfg.api_key, extra_body=cfg.extra_body, tool_extra=cfg.tool_extra)
