"""设置接口（rest-api.md“设置与记忆”的 GET/PUT /api/settings）。记忆接口归 B3a，不在此。"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.errors import ApiError
from app.llm.settings import get_settings, update_settings

router = APIRouter()

MAX_NAME = 200


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat_model: str | None = None
    small_model: str | None = None
    embedding_model: str | None = None
    api_base: str | None = None
    api_key: str | None = None
    web_search_default: bool | None = None
    memory_enabled: bool | None = None
    api_key_set: bool | None = None  # 只读字段：前端整份回传时忽略


@router.get("/settings")
def read_settings():
    return get_settings()


@router.put("/settings")
def write_settings(body: SettingsPatch):
    patch = body.model_dump(exclude_unset=True)
    patch.pop("api_key_set", None)
    patch = {k: v for k, v in patch.items() if v is not None or k == "api_key"}
    for k in ("chat_model", "small_model", "embedding_model"):
        if k in patch:
            patch[k] = patch[k].strip()
            if len(patch[k]) > MAX_NAME:
                raise ApiError("VALIDATION_ERROR", f"{k} 过长")
    if "api_base" in patch:
        base = patch["api_base"].strip()
        if base and not (base.startswith("http://") or base.startswith("https://")) or " " in base:
            raise ApiError("VALIDATION_ERROR", "api_base 必须是 http(s) 地址")
        patch["api_base"] = base
    if "api_key" in patch:
        patch["api_key"] = (patch["api_key"] or "").strip()
    return update_settings(patch)
