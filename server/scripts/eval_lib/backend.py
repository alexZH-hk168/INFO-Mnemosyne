"""系统 M（Mnemosyne 完整系统）与消融 A1–A4 的真实后端适配器（INT1 接上 B2/B3a 的进程内 Python API）。

做法：不起 HTTP 服务，直接在本进程里用后端的数据库与 Agent 回合（与 `POST /api/conversations/{cid}/messages` 走同一条
`app.agent.loop.run_turn`），记忆抽取同步跑 B3a 的 jobs（`app.jobs.worker.run_pending_jobs`）。

- start_item：每题一个项目（id 由题目 key 决定，重跑同一数据目录时复用）。
- replay_session：LongMemEval 每个 session 建一个对话；BranchMem 每题一个对话、session 接在 parent_backend_id 下，
  非 main 分支建 branches 行。按 turns 顺序写 user/assistant 消息（created_at 取 session 日期），每条 assistant 消息后
  调用 `memory.on_turn_finished` 并同步跑完记忆任务（抽取、L2 摘要、L4 画像）。记忆开关关闭时（U82）不抽取。
- ask：LongMemEval 在该题项目里新建对话提问；BranchMem 在 parent_backend_id 下提问（与分支里追问同一种 parent/branch 规则）。
  跑一轮完整回合，取回答正文（去 [[E#]]）、引用（supported/partial 的 message 证据 → 来源消息）、
  召回（recall_memory 步骤登记的证据 → 来源消息，按出现顺序给分 1/(rank+1)，后端不落库原始分数）。

消融开关（只在评测进程里临时替换，不改后端行为）：
  A1 open_source=False：本轮工具清单去掉 open_source；
  A2 citations=False：跳过引用校验，cited_message_ids 记空；
  A3 branch_scope=False：记忆召回不按分支路径过滤（替换 app.memory.recall 的可见性判断）；
  A4 l4_profile=False：系统提示不注入 L4 画像。

数据库：每题一个（<--backend-data>/items/<题目哈希>/mnemosyne.db）。记忆里有 global 作用域（偏好跨项目），
共用一个库会让别的题的历史被召回（跨题串味），所以每题等同一位新用户。
缓存：回放结果的命名空间含后端 git 提交、该题数据库的实例标识、记忆抽取模型与题目 key，所以只在同一题的
M/A1–A4 之间复用，不跨题复用（未决 U111）。

付费：--model 不是 fake 时要设 MN_EVAL_ALLOW_PAID=1（同 eval_lib.llm 的闸门），并且后端走 OpenAI 兼容接口，
地址与密钥读用户在设置页保存的 settings.json（BYOK，与对话、记忆同一份；环境变量 MN_LLM_API_BASE/MN_LLM_API_KEY 仍可作后备）。
默认 fake，不访问网络。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SERVER_DIR = Path(__file__).resolve().parents[2]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from .common import stable_int  # noqa: E402
from .data import EvalItem  # noqa: E402

DATE_RE = re.compile(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?")


def to_iso(date: str | None, fallback: str) -> str:
    """LongMemEval 日期 `2023/05/20 (Sat) 02:21` → `2023-05-20T02:21:00Z`；认不出时用 fallback。"""
    m = DATE_RE.search(date or "")
    if not m:
        return fallback
    y, mo, d, hh, mm = m.groups()
    return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}T{int(hh or 0):02d}:{int(mm or 0):02d}:00Z"


def _git_rev() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=SERVER_DIR, capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or "nogit"
    except (OSError, subprocess.SubprocessError):
        return "nogit"


class MnemosyneBackendAdapter:
    name = "backend"

    def __init__(self, *, model: str = "fake", data_dir: str | Path | None = None) -> None:
        if model != "fake" and os.environ.get("MN_EVAL_ALLOW_PAID") != "1":
            from .llm import PaidCallBlocked

            raise PaidCallBlocked(
                f"系统 M 用模型 {model} 会产生付费调用。按硬约束先用 --max-items 10 在 dev-120 上报成本、等用户确认预算；"
                "确认后设置环境变量 MN_EVAL_ALLOW_PAID=1 再运行。"
            )
        # BYOK：后端模型读用户在设置页保存的同一份 settings.json（api_base、API Key、小模型）。每题会换 MN_DATA_DIR，
        # 所以先把设置文件路径固定下来（MN_SETTINGS_PATH）；--model 只覆盖对话模型名（MN_EVAL_CHAT_MODEL）。
        if not os.environ.get("MN_SETTINGS_PATH"):
            from app.llm.settings import settings_path

            os.environ["MN_SETTINGS_PATH"] = str(settings_path().resolve())
        if model == "fake":
            os.environ["MN_LLM_BACKEND"] = "fake"
            os.environ.pop("MN_EVAL_CHAT_MODEL", None)
        else:
            os.environ["MN_LLM_BACKEND"] = "openai"
            os.environ["MN_EVAL_CHAT_MODEL"] = model
        os.environ.setdefault("MN_EMBED_BACKEND", "fake")
        os.environ.pop("MN_DB_PATH", None)
        self.model = model
        # 每题一个独立数据库（<root>/items/<题目哈希>/）：记忆有 global 作用域（偏好跨项目），
        # 同库会让别的题的历史被召回（跨题串味），所以按题隔离，等同“每题一位新用户”。
        self.root = Path(data_dir or os.environ.get("MN_DATA_DIR") or (SERVER_DIR / "data" / "eval")).resolve()
        self.conn = None
        self.config = None
        self._item: EvalItem | None = None
        self._project: dict[str, str] = {}
        self._branches: dict[tuple[str, str], str] = {}  # (题 key, 数据里的 branch_id) → 后端 branch id
        self._rev = _git_rev()
        self._instance = ""

    def _open_item_db(self, item: EvalItem) -> None:
        from app.config import get_config
        from app.db.conn import connect, init_db

        if self.conn is not None:
            self.conn.close()
        d = self.root / "items" / f"{stable_int(item.kind + '|' + item.key):016x}"
        os.environ["MN_DATA_DIR"] = str(d)
        self.config = get_config()
        self.conn = connect()
        init_db(self.conn, self.config)
        # 数据库实例标识：数据目录被清掉重建后，旧的回放缓存（指向旧库里的 message_id）自动失效
        marker = d / "eval_instance.txt"
        if not marker.exists() or not self.conn.execute("SELECT 1 FROM projects LIMIT 1").fetchone():
            import uuid

            marker.write_text(uuid.uuid4().hex, encoding="utf-8")
        self._instance = marker.read_text(encoding="utf-8").strip()

    # ---------- 协议 ----------

    def cache_namespace(self) -> str:
        from app.llm import llm_config

        item = self._item.key if self._item else ""
        return f"backend-v1|{self._rev}|{self._instance}|{llm_config().small_model}|{item}"

    def start_item(self, item: EvalItem) -> None:
        from app.ids import now_iso

        self._item = item
        self._open_item_db(item)
        pid = f"prj_eval{stable_int('project|' + item.kind + '|' + item.key):016x}"
        if self.conn.execute("SELECT 1 FROM projects WHERE id = ?", (pid,)).fetchone() is None:
            self.conn.execute("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)", (pid, f"eval {item.key}", now_iso()))
            self.conn.commit()
        self._project[item.key] = pid

    def replay_session(self, item: EvalItem, session: dict[str, Any], parent_backend_id: str | None):
        from app.ids import now_iso

        from .adapter import ReplayResult

        pid = self._project[item.key]
        ts = to_iso(session.get("date"), now_iso())
        if item.kind == "branchmem":
            cid = self._item_conversation(item, pid, ts)
        else:
            cid = self._new_conversation(pid, f"session {session['session_id']}", ts)
        ids: list[str] = []
        parent = parent_backend_id
        assistants: list[str] = []
        for t in session["turns"]:
            role = "assistant" if t.role == "assistant" else "user"
            branch = self._branch_for(item, cid, t.branch_id, parent, ts) if item.kind == "branchmem" else None
            mid = self._insert(cid, parent, branch, role, t.content, to_iso(t.date, ts))
            ids.append(mid)
            if role == "assistant":
                assistants.append(mid)
            parent = mid
        self.conn.commit()
        for aid in assistants:
            self._extract_memory(cid, aid)
        # 抽取用的是记忆子系统的小模型（假模型时为 0）；llm_port 暂不回报 token，真实模型下这里会低估（未决 U112）
        return ReplayResult(message_ids=ids)


    # ---------- 内部 ----------

    def _item_conversation(self, item: EvalItem, pid: str, ts: str) -> str:
        """BranchMem：每题一个对话，id 由题目 key 决定（回放命中缓存、跨进程时也能找回）。"""
        cid = f"cnv_eval{stable_int('conv|' + item.key):016x}"
        if self.conn.execute("SELECT 1 FROM conversations WHERE id = ?", (cid,)).fetchone() is None:
            self._new_conversation(pid, f"eval {item.key}", ts, cid=cid)
            self.conn.commit()
        return cid

    def _new_conversation(self, pid: str, title: str, ts: str, *, cid: str | None = None) -> str:
        from app.ids import new_id

        cid = cid or new_id("cnv")
        self.conn.execute(
            "INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", (cid, pid, title, ts, ts)
        )
        return cid

    def _insert(self, cid: str, parent: str | None, branch: str | None, role: str, content: str, ts: str) -> str:
        from app.ids import new_id

        mid = new_id("msg")
        self.conn.execute(
            "INSERT INTO messages (id, conversation_id, parent_id, branch_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (mid, cid, parent, branch, role, content, ts),
        )
        row = self.conn.execute("SELECT root_message_id FROM conversations WHERE id = ?", (cid,)).fetchone()
        if row["root_message_id"] is None:
            self.conn.execute("UPDATE conversations SET root_message_id = ? WHERE id = ?", (mid, cid))
        if branch is None:
            self.conn.execute("UPDATE conversations SET active_leaf_id = ?, updated_at = ? WHERE id = ?", (mid, ts, cid))
        return mid

    def _branch_for(self, item: EvalItem, cid: str, base_bid: str | None, fork: str | None, ts: str) -> str | None:
        if not base_bid or base_bid == "main":
            return None
        key = (item.key, base_bid)
        if key not in self._branches:
            bid = f"br_eval{stable_int('branch|' + item.key + '|' + base_bid):016x}"
            if self.conn.execute("SELECT 1 FROM branches WHERE id = ?", (bid,)).fetchone() is not None:
                self._branches[key] = bid
                return bid
            self.conn.execute(
                "INSERT INTO branches (id, conversation_id, fork_message_id, anchor_start, anchor_end, anchor_quote, title, status, created_at) "
                "VALUES (?, ?, ?, 0, 0, '', ?, 'open', ?)",
                (bid, cid, fork or "", base_bid, ts),
            )
            self._branches[key] = bid
        return self._branches[key]

    def _extract_memory(self, cid: str, aid: str) -> None:
        from app.jobs.worker import run_pending_jobs
        from app.memory.service import memory

        memory.on_turn_finished(self.conn, conversation_id=cid, assistant_message_id=aid)
        run_pending_jobs(self.conn)

    # ---------- ask ----------

    @contextlib.contextmanager
    def _flags(self, flags):
        """评测进程内临时替换，退出时还原。"""
        import app.agent.loop as loop
        import app.memory.recall as rec
        from app.agent import hooks

        saved: list[tuple[Any, str, Any]] = []

        def patch(obj, name, value):
            saved.append((obj, name, getattr(obj, name)))
            setattr(obj, name, value)

        if not flags.open_source:
            orig_schemas = loop.tool_schemas

            async def no_open_source(turn):
                return [t for t in await orig_schemas(turn) if t["function"]["name"] != "open_source"]

            patch(loop, "tool_schemas", no_open_source)
        if not flags.citations:
            async def no_verify(answer, pool, model, small):
                return [], (0, 0)

            patch(loop, "verify", no_verify)
        if not flags.branch_scope:
            patch(rec, "memory_item_visible", lambda *a, **k: True)
            patch(rec, "is_message_visible", lambda *a, **k: True)
            patch(rec, "digest_visible", lambda *a, **k: True)
        if not flags.l4_profile:
            orig_get = hooks.get_memory

            class NoProfile:
                def __init__(self, inner):
                    self._inner = inner

                def l4_profile(self, conn, project_id):
                    return ""

                def __getattr__(self, name):
                    return getattr(self._inner, name)

            patch(hooks, "get_memory", lambda: NoProfile(orig_get()))
        # 评测提问本身不写记忆（否则 M 的提问会被之后的 A1–A4 召回，系统之间串味）
        cur_get = hooks.get_memory

        class NoWrite:
            def __init__(self, inner):
                self._inner = inner

            def on_turn_finished(self, conn, **kw):
                return None

            def __getattr__(self, name):
                return getattr(self._inner, name)

        patch(hooks, "get_memory", lambda: NoWrite(cur_get()))
        try:
            yield
        finally:
            for obj, name, value in reversed(saved):
                setattr(obj, name, value)

    def ask(self, item: EvalItem, *, parent_backend_id: str | None, to_backend: dict[str, str], flags, k: int):
        from app.agent.events import registry
        from app.agent.loop import TurnRequest, run_turn
        from app.agent.text import strip_markers
        from app.ids import new_id, now_iso
        from app.llm import get_model, llm_config
        from app.llm.settings import memory_enabled

        from .adapter import AskResult

        pid = self._project[item.key]
        ts = to_iso(item.question_date, now_iso())
        if item.kind == "branchmem":
            cid = self._item_conversation(item, pid, ts)
            prow = self.conn.execute("SELECT branch_id FROM messages WHERE id = ?", (parent_backend_id,)).fetchone()
            branch = prow["branch_id"] if prow else None
            parent = parent_backend_id
        else:
            cid = self._new_conversation(pid, "", ts)
            branch, parent = None, None
        uid = self._insert(cid, parent, branch, "user", item.question, ts)
        aid = new_id("msg")
        self.conn.execute(
            "INSERT INTO messages (id, conversation_id, parent_id, branch_id, role, content, created_at) VALUES (?, ?, ?, ?, 'assistant', '', ?)",
            (aid, cid, uid, branch, now_iso()),
        )
        if branch is None:
            self.conn.execute("UPDATE conversations SET active_leaf_id = ? WHERE id = ?", (aid, cid))
        self.conn.commit()

        cfg = llm_config()
        req = TurnRequest(
            conversation_id=cid, project_id=pid, user_message_id=uid, assistant_message_id=aid, client_msg_id=None,
            parent_id=parent, branch_id=branch, question=item.question, web_search=False, scope={"mode": "all"},
            forced_skill=None, tier=None, memory_enabled=memory_enabled(), cfg=cfg, model=get_model(cfg),
        )
        t0 = time.monotonic()
        with self._flags(flags):

            async def go():
                handle = registry.register(aid)
                handle.task = asyncio.current_task()
                await run_turn(req, handle)

            asyncio.run(go())
        latency = int((time.monotonic() - t0) * 1000)

        msg = self.conn.execute("SELECT content, usage_json FROM messages WHERE id = ?", (aid,)).fetchone()
        err = self.conn.execute(
            "SELECT data_json FROM message_events WHERE message_id = ? AND event = 'error' LIMIT 1", (aid,)
        ).fetchone()
        if err is not None:
            raise RuntimeError(f"后端回合失败：{json.loads(err['data_json']).get('message')}")
        hyp, _ = strip_markers(msg["content"] or "")
        usage = json.loads(msg["usage_json"] or "{}") or {}
        end = self.conn.execute(
            "SELECT data_json FROM message_events WHERE message_id = ? AND event = 'message.end' LIMIT 1", (aid,)
        ).fetchone()
        if end is not None:
            latency = int(json.loads(end["data_json"]).get("latency_ms", latency))

        cited: list[str] = []
        if flags.citations:
            for r in self.conn.execute(
                "SELECT e.source_type, e.source_id FROM citations c JOIN evidence e ON e.id = c.evidence_id "
                "WHERE c.message_id = ? AND c.verdict IN ('supported', 'partial') ORDER BY c.sentence_start",
                (aid,),
            ):
                if r["source_type"] == "message" and r["source_id"] not in cited:
                    cited.append(r["source_id"])
        retrieved: list[tuple[str, float]] = []
        for tc in self.conn.execute(
            "SELECT result_json FROM tool_calls WHERE message_id = ? AND tool_name = 'recall_memory' ORDER BY step_index", (aid,)
        ):
            for eid in json.loads(tc["result_json"] or "{}").get("evidence_ids") or []:
                ev = self.conn.execute("SELECT source_id FROM evidence WHERE id = ?", (eid,)).fetchone()
                if ev and ev["source_id"] not in [m for m, _ in retrieved]:
                    retrieved.append((ev["source_id"], round(1.0 / (len(retrieved) + 1), 6)))
        branch_label = item.query_branch_id if item.kind == "branchmem" else None
        return AskResult(
            hyp.strip(), cited, retrieved[:k], branch_label,
            tokens_in=int(usage.get("prompt_tokens", 0)), tokens_out=int(usage.get("completion_tokens", 0)),
            latency_ms=latency, cost_usd=None,
        )
