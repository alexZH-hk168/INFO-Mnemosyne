"""设置接口（rest-api.md“设置与记忆”的 GET/PUT /api/settings）。记忆接口归 B3a，不在此。

BYOK（契约 v0.5 [BYOK]）：
- `GET /api/settings/providers`：服务商预设（presets.py，每项都按官方文档核对过）。
- `POST /api/settings/test`：用当前填写值（未填的沿用已保存值）做一次最省的连通检查，结果总是 200 + SettingsTestResult。
  优先 `GET {api_base}/models`（不计费）；服务不提供 /models 时才退回 1 个 token 的补全。密钥不回传、不进日志与提示。
"""

from __future__ import annotations

import time

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.errors import ApiError
from app.llm import errors as E
from app.llm.presets import PRESETS, PROVIDER_IDS, resolve
from app.llm.settings import get_settings, saved_api_key, update_settings

router = APIRouter()

MAX_NAME = 200
TEST_TIMEOUT = httpx.Timeout(connect=8.0, read=15.0, write=8.0, pool=8.0)
_transport: httpx.AsyncBaseTransport | None = None  # 测试注入 httpx.MockTransport，不访问网络


def set_test_transport(t: httpx.AsyncBaseTransport | None) -> None:
    global _transport
    _transport = t


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat_model: str | None = None
    small_model: str | None = None
    embedding_model: str | None = None
    api_base: str | None = None
    api_key: str | None = None
    web_search_default: bool | None = None
    memory_enabled: bool | None = None
    provider: str | None = None  # v0.5 [BYOK]
    # 只读字段：前端整份回传时忽略
    api_key_set: bool | None = None
    api_key_hint: str | None = None
    llm_mode: str | None = None
    retrieval_mode: str | None = None


class SettingsTestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str | None = None
    api_base: str | None = None
    api_key: str | None = None
    chat_model: str | None = None
    small_model: str | None = None
    embedding_model: str | None = None


def _check_base(base: str) -> str:
    base = base.strip()
    if base and not (base.startswith("http://") or base.startswith("https://")) or " " in base:
        raise ApiError("VALIDATION_ERROR", "api_base 必须是 http(s) 地址")
    return base.rstrip("/")


def _check_name(k: str, v: str) -> str:
    v = v.strip()
    if len(v) > MAX_NAME:
        raise ApiError("VALIDATION_ERROR", f"{k} 过长")
    return v


@router.get("/settings")
def read_settings():
    return get_settings()


@router.put("/settings")
def write_settings(body: SettingsPatch):
    patch = body.model_dump(exclude_unset=True)
    for ro in ("api_key_set", "api_key_hint", "llm_mode", "retrieval_mode"):
        patch.pop(ro, None)
    patch = {k: v for k, v in patch.items() if v is not None or k == "api_key"}
    for k in ("chat_model", "small_model", "embedding_model"):
        if k in patch:
            patch[k] = _check_name(k, patch[k])
    if "api_base" in patch:
        patch["api_base"] = _check_base(patch["api_base"])
    if "provider" in patch and patch["provider"] not in PROVIDER_IDS:
        raise ApiError("VALIDATION_ERROR", f"provider 只能是 {' / '.join(PROVIDER_IDS)}")
    if "api_key" in patch:
        patch["api_key"] = (patch["api_key"] or "").strip()
    return update_settings(patch)


@router.get("/settings/providers")
def list_providers():
    return {"providers": [p.public() for p in PRESETS]}


def _result(ok: bool, code: str, message: str, t0: float, **extra) -> dict:
    out = {"ok": ok, "code": code, "message": message, "latency_ms": int((time.monotonic() - t0) * 1000)}
    out.update(extra)
    return out


def _model_ids(data) -> dict[str, dict] | None:
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return None
    out = {}
    for m in items:
        if isinstance(m, dict) and isinstance(m.get("id"), str):
            out[m["id"]] = m
    return out


@router.post("/settings/test")
async def test_settings(body: SettingsTestBody):
    """测试连接（契约 v0.5 [BYOK]）。结果总是 200；请求字段不合法才 400。"""
    t0 = time.monotonic()
    cur = get_settings()
    provider = body.provider if body.provider is not None else cur["provider"]
    if provider not in PROVIDER_IDS:
        raise ApiError("VALIDATION_ERROR", f"provider 只能是 {' / '.join(PROVIDER_IDS)}")
    base = _check_base(body.api_base) if body.api_base is not None else cur["api_base"]
    chat = _check_name("chat_model", body.chat_model) if body.chat_model is not None else cur["chat_model"]
    small = _check_name("small_model", body.small_model) if body.small_model is not None else cur["small_model"]
    emb = _check_name("embedding_model", body.embedding_model) if body.embedding_model is not None else cur["embedding_model"]
    key = (body.api_key or "").strip() or saved_api_key()
    if not (base and key and chat):
        missing = [n for n, v in (("API 地址", base), ("API Key", key), ("对话模型", chat)) if not v]
        return _result(False, "not_configured", f"还缺：{'、'.join(missing)}", t0, tool_calls="unknown", embeddings="not_used")

    preset = resolve(provider, base)
    headers = {"Authorization": f"Bearer {key}"}
    tools = "supported" if preset and preset.supports_tools else "unknown"
    if emb:
        embeddings = "supported" if preset and preset.supports_embeddings else ("unsupported" if preset and preset.id != "custom" else "unknown")
    else:
        embeddings = "not_used"

    def fail(reason: str, status: int | None = None, detail: str = "") -> dict:
        return _result(False, reason, E.message_for(reason, status=status, detail=detail), t0, tool_calls=tools, embeddings=embeddings)

    client_kw = {"timeout": TEST_TIMEOUT}
    if _transport is not None:
        client_kw["transport"] = _transport
    try:
        async with httpx.AsyncClient(**client_kw) as client:
            # 1) 专门的密钥检查接口（OpenRouter 的 /models 不验证密钥，用 GET /key）
            if preset and preset.key_check_path:
                r = await client.get(base + preset.key_check_path, headers=headers)
                if r.status_code >= 400:
                    return fail(E.classify_status(r.status_code, r.text), r.status_code)
            # 2) 列模型：不计费
            url = f"{base}/models" + (f"?{preset.models_query}" if preset and preset.models_query else "")
            r = await client.get(url, headers=headers)
            ids = None
            if r.status_code < 400:
                try:
                    ids = _model_ids(r.json())
                except ValueError:
                    ids = None
            elif r.status_code not in (404, 405):
                return fail(E.classify_status(r.status_code, r.text), r.status_code)
            if ids:
                for label, name in (("对话模型", chat), ("小模型", small), ("嵌入模型", emb)):
                    if name and name not in ids:
                        return _result(
                            False, "model_not_found",
                            f"{label} {name} 不在这个服务的模型列表里，请检查模型名（大小写、厂商前缀）",
                            t0, tool_calls=tools, embeddings=embeddings,
                        )
                params = ids[chat].get("supported_parameters")
                if isinstance(params, list):  # OpenRouter 的模型元数据带 supported_parameters
                    tools = "supported" if "tools" in params else "unsupported"
                if tools == "unsupported":
                    return _result(
                        False, "tools_unsupported",
                        f"对话模型 {chat} 不支持工具调用（function calling），Mnemosyne 检索材料需要它，请换一个模型",
                        t0, tool_calls=tools, embeddings=embeddings,
                    )
                return _result(True, "ok", "连接成功：密钥有效，模型都在服务的模型列表里", t0, tool_calls=tools, embeddings=embeddings)
            # 3) 没有可用的模型列表：发 1 个 token 的补全确认密钥与模型（极少量计费）
            req = {"model": chat, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}
            if preset:
                req.update(preset.extra_body)
            r = await client.post(f"{base}/chat/completions", headers={**headers, "Content-Type": "application/json"}, json=req)
            if r.status_code >= 400:
                reason = E.classify_status(r.status_code, r.text)
                detail = E.upstream_summary(r.text, key) if reason == "bad_request" else ""
                return fail(reason, r.status_code, detail)
            try:
                data = r.json()
                data["choices"][0]
            except (ValueError, KeyError, IndexError, TypeError):
                return fail("bad_response")
            return _result(True, "ok", "连接成功：对话模型已回应（服务没有模型列表，用 1 个 token 的补全确认）", t0, tool_calls=tools, embeddings=embeddings)
    except httpx.HTTPError as e:
        return fail(E.classify_exception(e))
