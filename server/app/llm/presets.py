"""BYOK 服务商预设（契约 v0.5 [BYOK]：GET /api/settings/providers）。

Mnemosyne 不内置任何付费模型（用户决定 2026-11-23）。用户在设置里选服务商，界面按预设自动填 api_base 与推荐模型名，
密钥由用户自己填。每个预设的地址、模型名、工具调用与嵌入支持都按官方文档核对（核对日 2026-11-23，链接见 doc_urls）；
核对不了的服务商不放进预设，用户可选“自定义（OpenAI 兼容）”自己填。

核对记录：
- OpenAI
  - base_url https://api.openai.com/v1、GET /models：https://platform.openai.com/docs/api-reference/models/list
  - gpt-6.2-sol：Chat Completions（v1/chat/completions）、Streaming、Function calling 均 Supported：
    https://platform.openai.com/docs/models/gpt-6.2-sol
  - gpt-6-luna（小模型）：Chat Completions 支持；“Chat Completions supports function calling only with
    reasoning_effort set to none” → 带工具调用它时加 reasoning_effort=none（见 tool_extra_by_model）：
    https://platform.openai.com/docs/models/gpt-6-luna
  - 嵌入 text-embedding-3-small（默认 1536 维）：https://platform.openai.com/docs/guides/embeddings
- DeepSeek
  - base_url https://api.deepseek.com（OpenAI 格式），模型 deepseek-flash、deepseek-v4-pro，Tool Calls 两者都 ✓：
    https://api-docs.deepseek.com/ 、https://api-docs.deepseek.com/quick_start/pricing
  - 默认开启思考模式；带 tools 的请求在思考模式下必须把 reasoning_content 全部回传，否则 400。Mnemosyne 的回合不回传
    reasoning_content，所以对 DeepSeek 固定发 {"thinking": {"type": "disabled"}}（非思考模式的工具调用示例）：
    https://api-docs.deepseek.com/guides/thinking_mode 、https://api-docs.deepseek.com/guides/tool_calls
  - GET /models：https://api-docs.deepseek.com/api/list-models ；模型与价格页没有嵌入接口 → embedding_model 留空
  - 402 余额不足、401 密钥错误、429 限流：https://api-docs.deepseek.com/quick_start/error_codes
- OpenRouter
  - base_url https://openrouter.ai/api/v1（文档示例与 GET /api/v1/models）：https://openrouter.ai/docs/quickstart 、
    https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
  - 模型 slug 经公开模型列表核对（2026-11-23）：openai/gpt-6.2-sol、openai/gpt-6-luna 的 endpoints 含
    /api/v1/chat/completions，supported_parameters 含 tools；openai/text-embedding-3-small 的 endpoints 为 /api/v1/embeddings
  - 嵌入：https://openrouter.ai/docs/api/reference/embeddings
  - GET /models 不需要密钥，测试连接改用 GET /api/v1/key 验证密钥：https://openrouter.ai/docs/api-reference/limits
  - 流式过程中出错时 HTTP 仍是 200，错误作为一条带顶层 error 的 SSE data 发出：https://openrouter.ai/docs/api-reference/errors
未放进预设：阿里云百炼等（2026-11-23 官方文档页面无法读取正文，未能核对）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import urlparse


@dataclass(frozen=True)
class Preset:
    id: str
    name: str
    api_base: str
    chat_model: str
    small_model: str
    embedding_model: str  # "" = 该服务商没有嵌入接口
    supports_tools: bool
    supports_embeddings: bool
    notes_zh: str
    doc_urls: tuple[str, ...]
    # 每个对话请求都并入的请求体字段（如 DeepSeek 关闭思考模式）
    extra_body: dict = field(default_factory=dict)
    # 带 tools 调用某个模型时额外并入的字段（如 OpenAI gpt-6-luna 需要 reasoning_effort=none）
    tool_extra_by_model: dict = field(default_factory=dict)
    # 测试连接时用来验证密钥的路径（相对 api_base）；None = 用 GET /models 验证
    key_check_path: str | None = None
    # 列模型时附加的 query（OpenRouter 默认只列文本模型，嵌入模型要 output_modalities=all）
    models_query: str = ""

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "api_base": self.api_base,
            "chat_model": self.chat_model,
            "small_model": self.small_model,
            "embedding_model": self.embedding_model,
            "supports_tools": self.supports_tools,
            "supports_embeddings": self.supports_embeddings,
            "notes_zh": self.notes_zh,
            "doc_urls": list(self.doc_urls),
        }


PRESETS: tuple[Preset, ...] = (
    Preset(
        id="openai",
        name="OpenAI",
        api_base="https://api.openai.com/v1",
        chat_model="gpt-6.2-sol",
        small_model="gpt-6-luna",
        embedding_model="text-embedding-3-small",
        supports_tools=True,
        supports_embeddings=True,
        notes_zh="对话模型 gpt-6.2-sol，小模型 gpt-6-luna；支持工具调用与嵌入。",
        doc_urls=(
            "https://platform.openai.com/docs/models/gpt-6.2-sol",
            "https://platform.openai.com/docs/models/gpt-6-luna",
            "https://platform.openai.com/docs/guides/embeddings",
        ),
        tool_extra_by_model={"gpt-6-luna": {"reasoning_effort": "none"}},
    ),
    Preset(
        id="deepseek",
        name="DeepSeek",
        api_base="https://api.deepseek.com",
        chat_model="deepseek-v4-pro",
        small_model="deepseek-flash",
        embedding_model="",
        supports_tools=True,
        supports_embeddings=False,
        notes_zh="支持工具调用（Mnemosyne 以非思考模式调用）；没有嵌入接口，检索使用本地 BM25 与本地向量。",
        doc_urls=(
            "https://api-docs.deepseek.com/quick_start/pricing",
            "https://api-docs.deepseek.com/guides/tool_calls",
            "https://api-docs.deepseek.com/guides/thinking_mode",
        ),
        extra_body={"thinking": {"type": "disabled"}},
    ),
    Preset(
        id="openrouter",
        name="OpenRouter",
        api_base="https://openrouter.ai/api/v1",
        chat_model="openai/gpt-6.2-sol",
        small_model="openai/gpt-6-luna",
        embedding_model="openai/text-embedding-3-small",
        supports_tools=True,
        supports_embeddings=True,
        notes_zh="一个密钥调用多家模型；模型名带厂商前缀。是否支持工具调用以测试连接时模型列表里的 supported_parameters 为准。",
        doc_urls=(
            "https://openrouter.ai/docs/quickstart",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties",
            "https://openrouter.ai/docs/api/reference/embeddings",
        ),
        key_check_path="/key",
        models_query="output_modalities=all",
    ),
    Preset(
        id="custom",
        name="自定义（OpenAI 兼容）",
        api_base="",
        chat_model="",
        small_model="",
        embedding_model="",
        supports_tools=False,  # 未知：测试连接时显示“无法确认”
        supports_embeddings=False,
        notes_zh="任何提供 OpenAI 兼容 /chat/completions 的服务（含本机推理服务）。需要模型支持工具调用（function calling）。",
        doc_urls=(),
    ),
)

PROVIDER_IDS = tuple(p.id for p in PRESETS)


def get_preset(pid: str | None) -> Preset | None:
    for p in PRESETS:
        if p.id == pid:
            return p
    return None


def _host(base: str) -> str:
    try:
        return (urlparse(base).hostname or "").lower()
    except ValueError:
        return ""


def match_preset(api_base: str) -> Preset | None:
    """按 api_base 的主机名认出服务商（设置里没存 provider 时、或用户在“自定义”里填了官方地址时）。"""
    host = _host(api_base)
    if not host:
        return None
    for p in PRESETS:
        if p.api_base and _host(p.api_base) == host:
            return p
    return None


def resolve(provider: str | None, api_base: str) -> Preset | None:
    """实际生效的预设：地址主机名与预设一致才算（用户改了地址就不再套该预设的特殊参数）。"""
    p = get_preset(provider)
    if p and p.api_base and _host(p.api_base) == _host(api_base):
        return p
    return match_preset(api_base)
