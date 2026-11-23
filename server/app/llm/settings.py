"""用户设置（契约 rest-api.md“设置与记忆”的 Settings）的存取，以及据此得到的模型配置。

存储：`<MN_DATA_DIR>/settings.json`（权限 0600）。data-model.md 没有 settings 表，用文件避免改数据模型（U70）。
取值优先级：settings.json 里非空的值 > 环境变量 > 默认值。

环境变量：
- MN_LLM_BACKEND：fake（默认）| openai。只有显式设为 openai 才会访问真实模型接口（用户尚未定模型与预算，U2）。
- MN_LLM_API_BASE、MN_LLM_MODEL、MN_LLM_SMALL_MODEL、MN_LLM_API_KEY：OpenAI 兼容接口的地址、对话模型、小模型、密钥。
API Key 只写不读：接口只返回 api_key_set。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from app.config import get_config

FAKE_CHAT_MODEL = "fake-chat"
FAKE_SMALL_MODEL = "fake-small"

_FIELDS = ("chat_model", "small_model", "embedding_model", "api_base", "api_key", "web_search_default", "memory_enabled")


def _path() -> Path:
    return get_config().data_dir / "settings.json"


def _read_raw() -> dict:
    p = _path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in data.items() if k in _FIELDS} if isinstance(data, dict) else {}


def _write_raw(data: dict) -> None:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(p)


def backend() -> str:
    b = os.environ.get("MN_LLM_BACKEND", "fake").strip().lower()
    return "openai" if b == "openai" else "fake"


@dataclass(frozen=True)
class LLMConfig:
    backend: str  # fake | openai
    api_base: str
    chat_model: str
    small_model: str
    api_key: str

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


def llm_config() -> LLMConfig:
    raw = _read_raw()
    be = backend()
    if be == "fake":
        return LLMConfig("fake", "", FAKE_CHAT_MODEL, FAKE_SMALL_MODEL, "")
    chat = _pick(raw, "chat_model", "MN_LLM_MODEL")
    return LLMConfig(
        backend="openai",
        api_base=_pick(raw, "api_base", "MN_LLM_API_BASE").rstrip("/"),
        chat_model=chat,
        small_model=_pick(raw, "small_model", "MN_LLM_SMALL_MODEL") or chat,
        api_key=_pick(raw, "api_key", "MN_LLM_API_KEY"),
    )


def get_settings() -> dict:
    """契约 Settings 对象。"""
    raw = _read_raw()
    cfg = llm_config()
    if cfg.backend == "fake":
        chat, small, base = (
            _pick(raw, "chat_model", "MN_LLM_MODEL", FAKE_CHAT_MODEL),
            _pick(raw, "small_model", "MN_LLM_SMALL_MODEL", FAKE_SMALL_MODEL),
            _pick(raw, "api_base", "MN_LLM_API_BASE"),
        )
        key_set = bool(_pick(raw, "api_key", "MN_LLM_API_KEY"))
    else:
        chat, small, base, key_set = cfg.chat_model, cfg.small_model, cfg.api_base, bool(cfg.api_key)
    emb = raw.get("embedding_model") if isinstance(raw.get("embedding_model"), str) and raw.get("embedding_model") else get_config().embed_model
    return {
        "chat_model": chat,
        "small_model": small,
        "embedding_model": emb,
        "api_base": base,
        "api_key_set": key_set,
        "web_search_default": bool(raw.get("web_search_default", False)),
        "memory_enabled": bool(raw.get("memory_enabled", True)),
    }


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
