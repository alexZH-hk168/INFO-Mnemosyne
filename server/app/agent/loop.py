"""一个回合的完整流程（sse-events.md“顺序”）：

message.start → (step | evidence | delta)* → 正文生成完毕 → 引用校验 → citation* → 写库 → message.end
取消：停止生成，池里的引用一律以 partial 发出，写库，message.end(cancelled=true)。
失败：发 error，之后不再有 message.end（已生成的正文仍写回消息）。
回合结束后调用记忆接口 on_turn_finished（B3a 在其中写 jobs），首轮后生成对话标题（U21）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field

from app.agent import hooks
from app.agent.citations import Check, PoolItem, unverified, verify
from app.agent.context import build_messages
from app.agent.events import EventEmitter, TurnHandle, registry
from app.agent.tools import run_tool, tool_schemas
from app.db.conn import connect
from app.ids import new_id, now_iso
from app.llm import ChatModel, LLMConfig, ModelError, ToolCallReq
from app.llm.fake import TITLE_LEN, TITLE_TAG

log = logging.getLogger("mnemosyne.agent")

MAX_TOOL_STEPS = 8
DEFAULT_TITLES = ("", "新对话")


@dataclass
class TurnRequest:
    conversation_id: str
    project_id: str
    user_message_id: str
    assistant_message_id: str
    client_msg_id: str | None
    parent_id: str | None  # 用户消息的 parent
    branch_id: str | None
    question: str
    web_search: bool
    scope: dict
    forced_skill: str | None
    tier: str | None
    memory_enabled: bool
    cfg: LLMConfig
    model: ChatModel


@dataclass
class Turn:
    req: TurnRequest
    conn: object
    em: EventEmitter
    handle: TurnHandle
    pool: dict[str, PoolItem] = field(default_factory=dict)
    pool_titles: dict[str, str] = field(default_factory=dict)
    titles: dict[str, str] = field(default_factory=dict)
    dedupe: dict = field(default_factory=dict)
    plugin_tools: set[str] = field(default_factory=set)
    skills: list[dict] = field(default_factory=list)
    step_index: int = 0
    answer: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0

    # 工具与上下文读取的字段
    def __getattr__(self, name):
        if name == "req":
            raise AttributeError(name)
        return getattr(self.req, name)

    def check_cancel(self) -> None:
        """取消在回合真正开跑前到达时 task.cancel() 不生效，这里补一道检查。"""
        if self.handle.cancel_requested:
            raise asyncio.CancelledError()


def start_turn(req: TurnRequest) -> TurnHandle:
    """登记并在当前事件循环里启动回合（与 HTTP 连接解耦）。"""
    handle = registry.register(req.assistant_message_id)
    handle.task = asyncio.get_running_loop().create_task(run_turn(req, handle))
    return handle


async def run_turn(req: TurnRequest, handle: TurnHandle) -> None:
    conn = connect()
    em = EventEmitter(conn, req.assistant_message_id, handle)
    turn = Turn(req=req, conn=conn, em=em, handle=handle)
    t0 = time.monotonic()
    handle.started = True
    try:
        em.emit("message.start", {
            "message_id": req.assistant_message_id,
            "client_msg_id": req.client_msg_id,
            "user_message_id": req.user_message_id,
            "parent_id": req.parent_id,
            "branch_id": req.branch_id,
        })
        cancelled = False
        try:
            await _generate(turn)
        except asyncio.CancelledError:
            if not handle.cancel_requested:
                raise
            asyncio.current_task().uncancel()
            cancelled = True
        checks: list[Check]
        if cancelled:
            checks = unverified(turn.answer, turn.pool)
        else:
            handle.phase = "verifying"
            try:
                checks, usage = await verify(turn.answer, turn.pool, req.model, req.cfg.small_model)
                turn.prompt_tokens += usage[0]
                turn.completion_tokens += usage[1]
            except asyncio.CancelledError:
                if not handle.cancel_requested:
                    raise
                asyncio.current_task().uncancel()
                cancelled = True
                checks = unverified(turn.answer, turn.pool)
        handle.phase = "saving"
        cit_ids = _emit_citations(turn, checks)
        await _save(turn, checks, cit_ids)
        em.emit("message.end", {
            "message_id": req.assistant_message_id,
            "usage": {"prompt_tokens": turn.prompt_tokens, "completion_tokens": turn.completion_tokens},
            "latency_ms": int((time.monotonic() - t0) * 1000),
            "cancelled": cancelled,
        })
        handle.phase = "finished"
        if req.memory_enabled:
            try:
                hooks.get_memory().on_turn_finished(conn, conversation_id=req.conversation_id, assistant_message_id=req.assistant_message_id)
            except Exception:  # noqa: BLE001 - 记忆任务失败不影响已结束的回合
                log.exception("on_turn_finished 失败")
    except ModelError as e:
        # BYOK：提示是 app/llm/errors.py 给的中文可行动文字（已脱敏）；密钥无效、余额不足等重试无用时 retriable=false
        _fail(turn, "MODEL_UNAVAILABLE", str(e) or "模型接口不可用，请检查设置里的 API Key", bool(getattr(e, "retriable", True)))
    except asyncio.CancelledError:
        _fail(turn, "INTERNAL", "回答被中断，请重新生成", True)
    except Exception:  # noqa: BLE001
        log.exception("回合失败")
        _fail(turn, "INTERNAL", "服务器内部错误，请稍后重试", True)
    finally:
        handle.phase = "finished"
        registry.remove(req.assistant_message_id)
        handle.notify()
        conn.close()


async def _generate(turn: Turn) -> None:
    req = turn.req
    try:
        turn.skills = hooks.get_skills().list_enabled(turn.conn, project_id=req.project_id) or []
    except Exception:  # noqa: BLE001
        turn.skills = []
    forced_text = None
    turn.check_cancel()
    if req.forced_skill:
        out = await run_tool(turn, ToolCallReq(id="forced_skill", name="load_skill", arguments={"skill_id": req.forced_skill}))
        forced_text = out
    messages = build_messages(
        turn.conn, project_id=req.project_id, user_message_id=req.user_message_id,
        scope_mode=req.scope.get("mode", "all"), web_search=req.web_search, forced_skill_text=forced_text,
    )
    tools = await tool_schemas(turn)
    model_name = req.cfg.model_for(req.tier)
    used = 0
    for _ in range(MAX_TOOL_STEPS + 1):
        turn.check_cancel()
        allow_tools = bool(tools) and used < MAX_TOOL_STEPS
        calls: list[ToolCallReq] = []
        text = ""
        async for ch in req.model.stream(messages, model=model_name, tools=tools if allow_tools else None):
            if ch.text:
                text += ch.text
                turn.answer += ch.text
                turn.em.emit("delta", {"text": ch.text})
            if ch.tool_calls:
                calls.extend(ch.tool_calls)
            if ch.usage:
                turn.prompt_tokens += ch.usage[0]
                turn.completion_tokens += ch.usage[1]
        if not calls or not allow_tools:
            return
        calls = calls[: MAX_TOOL_STEPS - used]
        messages.append({
            "role": "assistant",
            "content": text or None,
            "tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": json.dumps(c.arguments, ensure_ascii=False)}}
                for c in calls
            ],
        })
        for c in calls:
            turn.check_cancel()
            result = await run_tool(turn, c)
            used += 1
            messages.append({"role": "tool", "tool_call_id": c.id, "content": result})


def _emit_citations(turn: Turn, checks: list[Check]) -> list[str]:
    ids = []
    for c in checks:
        cid = new_id("cit")
        ids.append(cid)
        turn.em.emit("citation", {
            "citation_id": cid, "eid": c.eid, "label": c.label,
            "sentence_start": c.start, "sentence_end": c.end, "verdict": c.verdict,
        })
    return ids


async def _save(turn: Turn, checks: list[Check], cit_ids: list[str]) -> None:
    req, conn = turn.req, turn.conn
    usage = {"prompt_tokens": turn.prompt_tokens, "completion_tokens": turn.completion_tokens}
    conn.execute(
        "UPDATE messages SET content = ?, model = ?, usage_json = ? WHERE id = ?",
        (turn.answer, req.cfg.model_for(req.tier), json.dumps(usage), req.assistant_message_id),
    )
    for cid, c in zip(cit_ids, checks):
        conn.execute(
            "INSERT INTO citations (id, message_id, evidence_id, label, sentence_start, sentence_end, verdict, overlap) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (cid, req.assistant_message_id, c.eid, c.label, c.start, c.end, c.verdict, c.overlap),
        )
    conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now_iso(), req.conversation_id))
    conn.commit()
    await _maybe_title(turn)


def fallback_title(question: str) -> str:
    return " ".join(question.split())[:TITLE_LEN]


def clean_title(text: str) -> str:
    t = " ".join((text or "").split())
    t = re.sub(r"^(标题[:：])", "", t).strip(" \"'“”‘’《》「」。.")
    return t[:TITLE_LEN]


async def _maybe_title(turn: Turn) -> None:
    """对话标题由后端在首轮后生成（U21）：小模型概括；假模型或失败时取首条用户消息前 20 字。"""
    req, conn = turn.req, turn.conn
    row = conn.execute("SELECT title FROM conversations WHERE id = ?", (req.conversation_id,)).fetchone()
    if row is None or (row["title"] or "") not in DEFAULT_TITLES:
        return
    first = conn.execute(
        "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at, rowid LIMIT 1",
        (req.conversation_id,),
    ).fetchone()
    question = first["content"] if first else req.question
    title = fallback_title(question)
    if req.cfg.backend != "fake":
        try:
            text, usage = await req.model.complete(
                [{"role": "user", "content": f"{TITLE_TAG}\n用不超过 {TITLE_LEN} 个字概括下面这个问题，作为对话标题，只输出标题：\n<question>\n{question[:2000]}\n</question>"}],
                model=req.cfg.small_model,
            )
            turn.prompt_tokens += usage[0]
            turn.completion_tokens += usage[1]
            title = clean_title(text) or title
        except ModelError:
            pass
    if title:
        conn.execute("UPDATE conversations SET title = ? WHERE id = ?", (title, req.conversation_id))
        conn.commit()


def _fail(turn: Turn, code: str, message: str, retriable: bool) -> None:
    try:
        turn.conn.execute("UPDATE messages SET content = ? WHERE id = ?", (turn.answer, turn.req.assistant_message_id))
        turn.conn.execute("UPDATE tool_calls SET status = 'error' WHERE message_id = ? AND status = 'running'", (turn.req.assistant_message_id,))
        turn.conn.commit()
        turn.em.emit("error", {"code": code, "message": message, "retriable": retriable})
    except Exception:  # noqa: BLE001
        log.exception("写 error 事件失败")
