"""消息接口（rest-api.md“消息”）：发消息、续流、取消、重新生成。都返回 sse-events.md 的事件流（取消除外）。"""

from __future__ import annotations

import sqlite3
from typing import Literal

from fastapi import APIRouter, Body, Depends, Header, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agent.events import registry, stream_events
from app.agent.loop import TurnRequest, start_turn
from app.api.deps import get_conn
from app.errors import ApiError, not_found
from app.ids import new_id, now_iso
from app.llm import ModelError, get_model, llm_config
from app.llm.settings import get_settings, memory_enabled

router = APIRouter()

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


class ScopeBody(BaseModel):
    mode: Literal["all", "selected", "none"] = "all"
    document_ids: list[str] | None = None


class SendBody(BaseModel):
    client_msg_id: str
    content: str
    parent_id: str | None = None
    branch_id: str | None = None
    web_search: bool = False
    scope: ScopeBody = ScopeBody()
    forced_skill: str | None = None


class RegenerateBody(BaseModel):
    """契约 v0.5（U74）：可选请求体；字段缺省时沿用原回合推断（_previous_options）。"""

    web_search: bool | None = None
    scope: ScopeBody | None = None
    forced_skill: str | None = None


def _sse(message_id: str, after_seq: int = 0) -> StreamingResponse:
    return StreamingResponse(stream_events(message_id, after_seq), media_type="text/event-stream", headers=SSE_HEADERS)


def _tier(x_model_tier: str | None) -> str | None:
    t = (x_model_tier or "").strip().lower()
    if t and t not in ("high", "fast"):
        raise ApiError("VALIDATION_ERROR", "X-Model-Tier 只能是 high 或 fast")
    return t or None


def _model_or_502():
    cfg = llm_config()
    try:
        return cfg, get_model(cfg)
    except ModelError as e:
        # 只有 MN_LLM_BACKEND=openai 强制真实模型且未配置齐时走到这里（auto 模式未配置直接用假模型）；文案与 fixture 一致
        raise ApiError("MODEL_UNAVAILABLE", "模型接口不可用，请检查设置里的 API Key") from e


def _first_assistant_child(conn: sqlite3.Connection, user_mid: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM messages WHERE parent_id = ? AND role = 'assistant' ORDER BY created_at, rowid LIMIT 1", (user_mid,)
    ).fetchone()


def _branch_leaf(conn: sqlite3.Connection, branch: sqlite3.Row) -> str:
    row = conn.execute(
        "SELECT id FROM messages WHERE branch_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", (branch["id"],)
    ).fetchone()
    return row["id"] if row else branch["fork_message_id"]


def _new_assistant(conn: sqlite3.Connection, conv: sqlite3.Row, user: sqlite3.Row) -> str:
    aid = new_id("msg")
    conn.execute(
        "INSERT INTO messages (id, conversation_id, parent_id, branch_id, role, content, created_at) VALUES (?, ?, ?, ?, 'assistant', '', ?)",
        (aid, conv["id"], user["id"], user["branch_id"], now_iso()),
    )
    if user["branch_id"] is None:  # 分支里的回答不改主线的当前叶子
        conn.execute("UPDATE conversations SET active_leaf_id = ?, updated_at = ? WHERE id = ?", (aid, now_iso(), conv["id"]))
    conn.commit()
    return aid


def _start(conn, conv, user, aid, *, web_search, scope, forced_skill, tier, cfg, model):
    start_turn(TurnRequest(
        conversation_id=conv["id"], project_id=conv["project_id"], user_message_id=user["id"], assistant_message_id=aid,
        client_msg_id=user["client_msg_id"], parent_id=user["parent_id"], branch_id=user["branch_id"],
        question=user["content"], web_search=web_search, scope=scope, forced_skill=forced_skill, tier=tier,
        memory_enabled=memory_enabled(), cfg=cfg, model=model,
    ))


@router.post("/conversations/{cid}/messages")
async def send_message(
    cid: str,
    body: SendBody,
    x_model_tier: str | None = Header(default=None),
    conn: sqlite3.Connection = Depends(get_conn),
):
    conv = conn.execute("SELECT * FROM conversations WHERE id = ?", (cid,)).fetchone()
    if conv is None:
        raise not_found("对话")
    if not body.client_msg_id.strip():
        raise ApiError("VALIDATION_ERROR", "client_msg_id 不能为空")
    if not body.content.strip():
        raise ApiError("VALIDATION_ERROR", "消息内容不能为空")
    tier = _tier(x_model_tier)
    scope = body.scope.model_dump(exclude_none=True)

    dup = conn.execute("SELECT * FROM messages WHERE client_msg_id = ?", (body.client_msg_id,)).fetchone()
    if dup is not None:
        return _duplicate(conn, conv, dup, body, scope, tier)

    cfg, model = _model_or_502()
    parent_id, branch_id = _resolve_parent(conn, conv, body)
    uid = new_id("msg")
    try:
        conn.execute(
            "INSERT INTO messages (id, conversation_id, parent_id, branch_id, role, content, created_at, client_msg_id) "
            "VALUES (?, ?, ?, ?, 'user', ?, ?, ?)",
            (uid, cid, parent_id, branch_id, body.content, now_iso(), body.client_msg_id),
        )
    except sqlite3.IntegrityError:
        conn.rollback()
        dup = conn.execute("SELECT * FROM messages WHERE client_msg_id = ?", (body.client_msg_id,)).fetchone()
        return _duplicate(conn, conv, dup, body, scope, tier)
    if conv["root_message_id"] is None:
        conn.execute("UPDATE conversations SET root_message_id = ? WHERE id = ?", (uid, cid))
    conn.commit()
    user = conn.execute("SELECT * FROM messages WHERE id = ?", (uid,)).fetchone()
    aid = _new_assistant(conn, conv, user)
    _start(conn, conv, user, aid, web_search=body.web_search, scope=scope, forced_skill=body.forced_skill, tier=tier, cfg=cfg, model=model)
    return _sse(aid)


def _duplicate(conn, conv, dup, body, scope, tier):
    """重复的 client_msg_id：返回同一条消息的事件流，不新建消息（rest-api.md、错误码 DUPLICATE_CLIENT_MSG 为 200）。"""
    if dup["conversation_id"] != conv["id"] or dup["role"] != "user":
        raise ApiError("VALIDATION_ERROR", "client_msg_id 已被其他消息使用")
    child = _first_assistant_child(conn, dup["id"])
    if child is not None:
        return _sse(child["id"])
    cfg, model = _model_or_502()
    aid = _new_assistant(conn, conv, dup)
    _start(conn, conv, dup, aid, web_search=body.web_search, scope=scope, forced_skill=body.forced_skill, tier=tier, cfg=cfg, model=model)
    return _sse(aid)


def _resolve_parent(conn: sqlite3.Connection, conv: sqlite3.Row, body: SendBody) -> tuple[str | None, str | None]:
    branch = None
    if body.branch_id:
        branch = conn.execute("SELECT * FROM branches WHERE id = ?", (body.branch_id,)).fetchone()
        if branch is None or branch["conversation_id"] != conv["id"]:
            raise ApiError("VALIDATION_ERROR", "branch_id 不属于该对话")
        _check_branch_open(branch)
    if body.parent_id and not body.branch_id:
        prow = conn.execute("SELECT branch_id FROM messages WHERE id = ?", (body.parent_id,)).fetchone()
        if prow is not None and prow["branch_id"]:
            pb = conn.execute("SELECT * FROM branches WHERE id = ?", (prow["branch_id"],)).fetchone()
            if pb is not None:
                _check_branch_open(pb)
    if body.parent_id:
        parent = conn.execute("SELECT * FROM messages WHERE id = ?", (body.parent_id,)).fetchone()
        if parent is None or parent["conversation_id"] != conv["id"]:
            raise ApiError("VALIDATION_ERROR", "parent_id 不属于该对话")
        return parent["id"], (branch["id"] if branch else parent["branch_id"])
    if branch is not None:
        return _branch_leaf(conn, branch), branch["id"]
    return conv["active_leaf_id"], None


def _check_branch_open(branch: sqlite3.Row) -> None:
    """U87：已合并 / 已归档的分支只读，不再接收新消息（rest-api.md 错误码 VALIDATION_ERROR，400）。"""
    if branch["status"] == "merged":
        raise ApiError("VALIDATION_ERROR", "分支已合并到主线，不能再发消息", details={"branch_status": "merged"})
    if branch["status"] == "archived":
        raise ApiError("VALIDATION_ERROR", "分支已归档，不能再发消息", details={"branch_status": "archived"})


@router.get("/messages/{mid}/events")
async def resume_events(mid: str, after_seq: int = Query(0, ge=0), conn: sqlite3.Connection = Depends(get_conn)):
    row = conn.execute("SELECT role FROM messages WHERE id = ?", (mid,)).fetchone()
    if row is None:
        raise not_found("消息")
    if row["role"] != "assistant":
        raise ApiError("VALIDATION_ERROR", "只有助手回答有事件流")
    return _sse(mid, after_seq)


@router.post("/messages/{mid}/cancel")
async def cancel_message(mid: str, conn: sqlite3.Connection = Depends(get_conn)):
    if conn.execute("SELECT 1 FROM messages WHERE id = ?", (mid,)).fetchone() is None:
        raise not_found("消息")
    handle = registry.get(mid)
    if handle is not None:
        handle.request_cancel()
    return {"ok": True}


def _previous_options(conn: sqlite3.Connection, mid: str) -> tuple[bool, dict]:
    """重新生成没带请求体（或请求体缺字段）时：从原回答的步骤推断联网开关与材料范围（U74）。"""
    import json

    web = bool(get_settings().get("web_search_default"))
    scope: dict = {"mode": "all"}
    for r in conn.execute("SELECT tool_name, args_json FROM tool_calls WHERE message_id = ? ORDER BY step_index", (mid,)):
        if r["tool_name"] in ("search_web", "fetch_url"):
            web = True
        if r["tool_name"] == "search_materials":
            try:
                s = json.loads(r["args_json"] or "{}").get("scope")
            except ValueError:
                s = None
            if isinstance(s, dict) and s.get("mode") in ("all", "selected", "none"):
                scope = s
    return web, scope


@router.post("/messages/{mid}/regenerate")
async def regenerate(
    mid: str,
    body: RegenerateBody | None = Body(default=None),
    x_model_tier: str | None = Header(default=None),
    conn: sqlite3.Connection = Depends(get_conn),
):
    msg = conn.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()
    if msg is None:
        raise not_found("消息")
    if msg["role"] != "assistant":
        raise ApiError("VALIDATION_ERROR", "只能重新生成助手回答")
    user = conn.execute("SELECT * FROM messages WHERE id = ?", (msg["parent_id"],)).fetchone() if msg["parent_id"] else None
    if user is None or user["role"] != "user":
        raise ApiError("VALIDATION_ERROR", "这条回答没有对应的用户消息")
    tier = _tier(x_model_tier)
    cfg, model = _model_or_502()
    conv = conn.execute("SELECT * FROM conversations WHERE id = ?", (msg["conversation_id"],)).fetchone()
    if user["branch_id"]:
        ub = conn.execute("SELECT * FROM branches WHERE id = ?", (user["branch_id"],)).fetchone()
        if ub is not None:
            _check_branch_open(ub)  # U87：只读分支里也不能重新生成
    web, scope = _previous_options(conn, mid)
    forced = None
    if body is not None:  # U74：请求体优先，缺省字段沿用推断
        if body.web_search is not None:
            web = body.web_search
        if body.scope is not None:
            scope = body.scope.model_dump(exclude_none=True)
        forced = body.forced_skill or None
    aid = _new_assistant(conn, conv, user)
    _start(conn, conv, user, aid, web_search=web, scope=scope, forced_skill=forced, tier=tier, cfg=cfg, model=model)
    return _sse(aid)
