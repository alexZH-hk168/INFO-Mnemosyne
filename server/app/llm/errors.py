"""模型接口错误的分类与脱敏（BYOK）。

- 分类：把 HTTP 状态码、响应体里的错误码、网络异常归成几种原因（reason），每种给一句中文可行动提示。
  对话回合以 SSE `error` 事件结束（code 仍是契约已有的 MODEL_UNAVAILABLE），测试连接接口返回同一套原因。
- 脱敏：任何要显示或写日志的上游文字都先经 `redact()`：去掉本机保存的密钥原文、`Bearer xxx` 与常见密钥形态。
  上游错误原文默认不进提示，只有 400/422（请求被拒，往往是“模型不支持工具调用”之类）才附一段脱敏后的摘要。

各服务商的错误码依据（核对日 2026-11-23）：
- OpenAI：401 密钥错误；429 的 error.code 为 credit_balance_exhausted / *_spend_limit_exceeded /
  organization_usage_limit_exceeded（error.type 可能仍是 insufficient_quota）时属额度问题，其余 429 是限流。
  https://platform.openai.com/docs/guides/error-codes
- DeepSeek：401 密钥错误、402 余额不足、429 限流、500/503 服务端。https://api-docs.deepseek.com/quick_start/error_codes
- OpenRouter：401 密钥无效、402 余额不足、403 权限/预算/审核、408 超时、429 限流、502/503 上游不可用；流式中途出错时
  HTTP 200 + 一条带顶层 error 的 SSE data（error.metadata.error_type）。https://openrouter.ai/docs/api-reference/errors
"""

from __future__ import annotations

import json
import re

import httpx

# reason → (中文提示, retriable)
REASONS: dict[str, tuple[str, bool]] = {
    "key_invalid": ("模型密钥无效或没有权限，请到“设置 → 模型”检查 API Key", False),
    "insufficient_balance": ("模型账户余额不足或额度已用完，请到服务商处充值或调整额度后重试", False),
    "rate_limited": ("模型服务限流，请稍等片刻再试", True),
    "model_not_found": ("模型不存在或 API 地址不对，请到“设置 → 模型”检查模型名和 API 地址", False),
    "bad_request": ("模型服务拒绝了这次请求", False),
    "timeout": ("模型服务响应超时，请稍后重试或换一个更快的模型", True),
    "unreachable": ("连不上模型服务，请检查 API 地址和网络", True),
    "server_error": ("模型服务暂时不可用，请稍后重试", True),
    "bad_response": ("模型服务的响应格式不对，这个地址可能不是 OpenAI 兼容接口", True),
    "not_configured": ("还没有配置模型：请到“设置 → 模型”填写 API 地址、API Key 和对话模型", False),
}

_QUOTA_CODES = {
    "insufficient_quota",
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
    "payment_required",
}
_KEY_PATTERNS = [
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-~+/=]{6,}"),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{6,}"),
    re.compile(r"(?i)(api[_-]?key|authorization|token)([\"']?\s*[:=]\s*[\"']?)[^\s\"',}]{6,}"),
]


def redact(text: str, *secrets: str) -> str:
    """去掉密钥原文（含只露一部分的形态）与常见密钥模式。secrets 为空串时忽略。"""
    out = text or ""
    for s in secrets:
        s = (s or "").strip()
        if len(s) >= 4:
            out = out.replace(s, "[已隐藏]")
            # 有的服务商在错误里只回显密钥的头尾（如 sk-abc...wxyz），把长度 ≥ 8 的前缀/后缀也去掉
            if len(s) >= 12:
                out = out.replace(s[:8], "[已隐藏]").replace(s[-6:], "[已隐藏]")
    for p in _KEY_PATTERNS:
        out = p.sub(lambda m: (m.group(1) + m.group(2) + "[已隐藏]") if m.lastindex and m.lastindex >= 2 else "[已隐藏]", out)
    return out


def _error_obj(body: str) -> dict:
    try:
        data = json.loads(body)
    except (ValueError, TypeError):
        return {}
    if isinstance(data, dict) and isinstance(data.get("error"), dict):
        return data["error"]
    return {}


def _codes(err: dict) -> set[str]:
    out: set[str] = set()
    for k in ("code", "type"):
        v = err.get(k)
        if isinstance(v, str):
            out.add(v.lower())
    meta = err.get("metadata")
    if isinstance(meta, dict):
        for k in ("error_type", "limit_source", "reason"):
            v = meta.get(k)
            if isinstance(v, str):
                out.add(v.lower())
    return out


def classify_status(status: int, body: str = "") -> str:
    err = _error_obj(body)
    codes = _codes(err)
    if status in (401,) or "authentication" in codes or "invalid_api_key" in codes:
        return "key_invalid"
    if status == 402 or codes & _QUOTA_CODES or any(c.startswith("openrouter_") and c.endswith(("_budget", "_credits", "_key_limit")) for c in codes):
        return "insufficient_balance"
    if status == 403:
        return "key_invalid"
    if status == 404 or "model_not_found" in codes or "not_found" in codes:
        return "model_not_found"
    if status == 429 or "rate_limit_exceeded" in codes:
        return "rate_limited"
    if status in (408, 504) or "timeout" in codes:
        return "timeout"
    if status >= 500:
        return "server_error"
    return "bad_request"


def classify_stream_error(err: dict) -> str:
    """流式过程中收到的 {error: {...}}（OpenRouter 的 mid-stream error 等）。"""
    codes = _codes(err)
    status = err.get("code") if isinstance(err.get("code"), int) else 0
    if "authentication" in codes:
        return "key_invalid"
    if "payment_required" in codes or codes & _QUOTA_CODES:
        return "insufficient_balance"
    if "rate_limit_exceeded" in codes:
        return "rate_limited"
    if "timeout" in codes:
        return "timeout"
    if "not_found" in codes:
        return "model_not_found"
    if status:
        return classify_status(status, json.dumps({"error": err}))
    return "server_error"


def classify_exception(e: BaseException) -> str:
    if isinstance(e, httpx.TimeoutException):
        return "timeout"
    return "unreachable"


def upstream_summary(body: str, *secrets: str, limit: int = 160) -> str:
    """400/422 时给用户看的上游原因摘要（已脱敏、截断）；取 error.message，没有就空。"""
    err = _error_obj(body)
    msg = err.get("message") if isinstance(err.get("message"), str) else ""
    msg = redact(" ".join(msg.split()), *secrets)
    return msg[:limit]


def message_for(reason: str, *, status: int | None = None, detail: str = "") -> str:
    text, _ = REASONS.get(reason, REASONS["server_error"])
    if status:
        text += f"（HTTP {status}）"
    if detail:
        text += f"：{detail}"
    return text


def retriable(reason: str) -> bool:
    return REASONS.get(reason, REASONS["server_error"])[1]
