"""用户设置（契约 rest-api.md“设置与记忆”的 Settings）的存取，以及据此得到的模型配置（BYOK）。

存储：`<MN_DATA_DIR>/settings.json`（权限 0600）；`MN_SETTINGS_PATH` 可指向别处（评测每题换数据目录时仍读用户那一份）。
data-model.md 没有 settings 表，用文件避免改数据模型（U70）。
取值优先级：settings.json 里非空的值 > 环境变量 > 默认值。

BYOK（用户决定 2026-11-23“模型API这里做成用户可以用自己的byok”）：Mnemosyne 不内置付费模型。
- MN_LLM_BACKEND 未设置（默认 auto）：设置里（或环境变量里）api_base、API Key、对话模型三项齐全就用真实模型，
  否则用确定性假模型，界面标“演示模式”（Settings.llm_mode）。
- MN_LLM_BACKEND=fake：强制假模型（测试、冒烟用），即使已配置也不访问网络。
- MN_LLM_BACKEND=openai：强制真实模型；没配置齐时发消息返回 MODEL_UNAVAILABLE。
环境变量 MN_LLM_API_BASE、MN_LLM_MODEL、MN_LLM_SMALL_MODEL、MN_LLM_API_KEY 作为设置的后备值。
评测专用：MN_EVAL_CHAT_MODEL 覆盖对话模型名（run_eval --model），见 scripts/eval_lib/backend.py。

密钥只写不读：接口只返回 api_key_set 与末 4 位掩码 api_key_hint（密钥 ≥ 12 位时才给）。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from app.config import get_config
from app.llm.presets import PROVIDER_IDS, match_preset, resolve

FAKE_CHAT_MODEL = "fake-chat"
FAKE_SMALL_MODEL = "fake-small"

_FIELDS = ("chat_model", "small_model", "embedding_model", "api_base", "api_key", "web_search_default", "memory_enabled", "provider")


def settings_path() -> Path:
    p = os.environ.get("MN_SETTINGS_PATH", "").strip()
    return Path(p) if p else get_config().data_dir / "settings.json"


def _read_raw() -> dict:
    p = settings_path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in data.items() if k in _FIELDS} if isinstance(data, dict) else {}


def _write_raw(data: dict) -> None:
    p = settings_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    # 先建 0600 的空文件再写，避免密钥落在默认权限的文件里哪怕一瞬间
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2))
    os.chmod(tmp, 0o600)
    tmp.replace(p)


def backend_mode() -> str:
    """auto（默认）| fake（强制假模型）| openai（强制真实模型）。"""
    b = os.environ.get("MN_LLM_BACKEND", "").strip().lower()
    return b if b in ("fake", "openai") else "auto"


def backend() -> str:
    """兼容旧调用：当前实际使用的后端 fake | openai。"""
    return llm_config().backend


@dataclass(frozen=True)
class LLMConfig:
    backend: str  # fake | openai
    api_base: str
    chat_model: str
    small_model: str
    api_key: str
    provider: str = "custom"
    # 每个对话请求都并入的字段、带工具调用某模型时并入的字段（来自服务商预设，见 presets.py）
    extra_body: dict = field(default_factory=dict, compare=False)
    tool_extra: dict = field(default_factory=dict, compare=False)
    demo_reason: str = ""  # backend=fake 时：not_configured | forced

    def model_for(self, tier: str | None) -> str:
        return self.small_model if tier == "fast" else self.chat_model

    @property
    def configured(self) -> bool:
        if self.backend == "fake":
            return True
        return bool(self.api_base and self.chat_model and self.api_key)


def _pick(raw: dict, key: str, env: str, default: str = "") -> str:
    v = raw.get(key)
    if isinstance(v, str) and v.strip():
        return v.strip()
    return os.environ.get(env, default).strip()


def _fake(reason: str) -> LLMConfig:
    return LLMConfig("fake", "", FAKE_CHAT_MODEL, FAKE_SMALL_MODEL, "", demo_reason=reason)


def _real_values(raw: dict) -> tuple[str, str, str, str]:
    chat = os.environ.get("MN_EVAL_CHAT_MODEL", "").strip() or _pick(raw, "chat_model", "MN_LLM_MODEL")
    base = _pick(raw, "api_base", "MN_LLM_API_BASE").rstrip("/")
    small = _pick(raw, "small_model", "MN_LLM_SMALL_MODEL") or chat
    key = _pick(raw, "api_key", "MN_LLM_API_KEY")
    return base, chat, small, key


def _provider_id(raw: dict, base: str) -> str:
    p = raw.get("provider")
    if isinstance(p, str) and p in PROVIDER_IDS:
        return p
    m = match_preset(base)
    return m.id if m else "custom"


def llm_config() -> LLMConfig:
    mode = backend_mode()
    if mode == "fake":
        return _fake("forced")
    raw = _read_raw()
    base, chat, small, key = _real_values(raw)
    if mode == "auto" and not (base and chat and key):
        return _fake("not_configured")
    provider = _provider_id(raw, base)
    preset = resolve(provider, base)
    return LLMConfig(
        backend="openai",
        api_base=base,
        chat_model=chat,
        small_model=small,
        api_key=key,
        provider=provider,
        extra_body=dict(preset.extra_body) if preset else {},
        tool_extra={k: dict(v) for k, v in preset.tool_extra_by_model.items()} if preset else {},
    )


def saved_api_key() -> str:
    """测试连接时请求体没带 api_key 就用已存的（只在后端内部用，不回传）。"""
    return _pick(_read_raw(), "api_key", "MN_LLM_API_KEY")


def key_hint(key: str) -> str | None:
    """末 4 位掩码；密钥短于 12 位时不给（避免暴露短密钥的大部分）。"""
    key = (key or "").strip()
    return f"••••{key[-4:]}" if len(key) >= 12 else None


def get_settings() -> dict:
    """契约 Settings 对象（v0.5 [BYOK] 追加 provider、api_key_hint?、llm_mode、retrieval_mode）。"""
    raw = _read_raw()
    cfg = llm_config()
    base, _chat, _small, key = _real_values(raw)
    chat = _pick(raw, "chat_model", "MN_LLM_MODEL")
    small = _pick(raw, "small_model", "MN_LLM_SMALL_MODEL") or chat
    emb_raw = raw.get("embedding_model")
    conf = get_config()
    if isinstance(emb_raw, str):
        emb = emb_raw
    else:
        emb = conf.embed_model if conf.embed_backend == "openai" else ""
    if cfg.backend == "fake":
        mode = "demo_forced" if cfg.demo_reason == "forced" else "demo"
    else:
        mode = "real"
    out = {
        "chat_model": chat,
        "small_model": small,
        "embedding_model": emb,
        "api_base": base,
        "api_key_set": bool(key),
        "web_search_default": bool(raw.get("web_search_default", False)),
        "memory_enabled": bool(raw.get("memory_enabled", True)),
        "provider": _provider_id(raw, base),
        "llm_mode": mode,
        "retrieval_mode": "embedding" if conf.embed_backend == "openai" else "local",
    }
    hint = key_hint(key)
    if hint:
        out["api_key_hint"] = hint
    return out


def update_settings(patch: dict) -> dict:
    """patch 已经过接口层校验。api_key 为空串表示清除。"""
    raw = _read_raw()
    for k, v in patch.items():
        if k not in _FIELDS:
            continue
        if k == "api_key" and not v:
            raw.pop("api_key", None)
            continue
        raw[k] = v
    _write_raw(raw)
    return get_settings()


def memory_enabled() -> bool:
    return bool(_read_raw().get("memory_enabled", True))
