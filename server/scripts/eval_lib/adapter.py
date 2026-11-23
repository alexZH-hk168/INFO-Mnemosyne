"""系统 M（Mnemosyne 完整系统）与消融 A1–A4 的后端适配层。

run_eval.py 只通过 BackendAdapter 协议与后端交互：
  1. replay_session(...)：把一个历史 session 回放进后端（建消息、触发记忆抽取），返回每个轮次的后端 message_id。
     回放结果按「缓存键」落盘（ReplayCache），同一 session 在不同题、不同系统（M、A1–A4）之间复用（立项稿 11.5）。
  2. ask(...)：在后端提一个问题（BranchMem 时挂在提问节点的父消息下），拿回答、引用的 message_id、检索到的 message_id 与分数。

本轮（2026-11-23）B2 的 Python API 尚在并行开发，`MnemosyneBackendAdapter` 只写了接口与 TODO；
测试与流水线自检用 `StubAdapter`（本地词面检索 + 抽取式回答，不代表 M 的效果，结果不得写进论文）。
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol

from .common import canonical_json, stable_int
from .data import EvalItem
from .retrieval import HashEmbedder, top_k


@dataclass(frozen=True)
class Flags:
    """消融开关（立项稿 11.2）。"""

    open_source: bool = True  # A1=False：不调用 open_source 回溯原文，只用 L2/L3 记忆
    citations: bool = True  # A2=False：不要求引用、不做引用校验
    branch_scope: bool = True  # A3=False：检索不按当前分支路径过滤（只在 BranchMem 上跑）
    l4_profile: bool = True  # A4=False：不注入 L4 画像摘要


SYSTEM_FLAGS: dict[str, Flags] = {
    "M": Flags(),
    "A1": Flags(open_source=False),
    "A2": Flags(citations=False),
    "A3": Flags(branch_scope=False),
    "A4": Flags(l4_profile=False),
}


@dataclass
class ReplayResult:
    message_ids: list[str]  # 与 session 的 turns 一一对应
    tokens_in: int = 0  # 回放阶段（记忆抽取等）消耗，只在首次回放时计
    tokens_out: int = 0
    cost_usd: float | None = None
    cached: bool = False


@dataclass
class AskResult:
    hypothesis: str
    cited_message_ids: list[str]
    retrieved: list[tuple[str, float]]  # 有序 [(message_id, score)]
    branch_id: str | None
    tokens_in: int
    tokens_out: int
    latency_ms: int
    cost_usd: float | None


class BackendAdapter(Protocol):
    name: str

    def cache_namespace(self) -> str:
        """缓存命名空间：后端版本 + 数据库标识 + 记忆抽取模型等，任何一项变了回放缓存就失效。"""
        ...

    def start_item(self, item: EvalItem) -> None:
        """每题开始前调用（例如为该题建项目）。"""
        ...

    def replay_session(self, item: EvalItem, session: dict[str, Any], parent_backend_id: str | None) -> ReplayResult: ...

    def ask(self, item: EvalItem, *, parent_backend_id: str | None, to_backend: dict[str, str], flags: Flags, k: int) -> AskResult:
        """to_backend：本题基线 message_id → 后端 message_id（真实后端可以不用，它按项目/对话自己知道范围）。"""
        ...


def session_cache_key(item: EvalItem, session: dict[str, Any], namespace: str) -> str:
    """LongMemEval：按 session_id（同一 session 内容在各题中相同）；BranchMem：session 挂在树上的位置随题而变，
    所以再加 item_id。内容也进键，防止同名 session 内容不同时误用缓存。"""
    content = [(t.role, t.content) for t in session["turns"]]
    scope = item.key if item.kind == "branchmem" else ""
    raw = canonical_json({"ns": namespace, "scope": scope, "sid": session["session_id"], "date": session["date"], "c": content})
    return f"{stable_int(raw):016x}"


class ReplayCache:
    def __init__(self, root: str | Path | None):
        self.root = Path(root) if root else None
        self.mem: dict[str, ReplayResult] = {}
        self.hits = 0
        self.misses = 0

    def _path(self, key: str) -> Path:
        assert self.root is not None
        return self.root / key[:2] / f"{key}.json"

    def get(self, key: str) -> ReplayResult | None:
        if key in self.mem:
            return self.mem[key]
        if self.root is not None and self._path(key).exists():
            r = ReplayResult(**json.loads(self._path(key).read_text(encoding="utf-8")))
            self.mem[key] = r
            return r
        return None

    def put(self, key: str, r: ReplayResult) -> None:
        self.mem[key] = r
        if self.root is not None:
            p = self._path(key)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(asdict(r), ensure_ascii=False), encoding="utf-8")


def replay_item(adapter: BackendAdapter, cache: ReplayCache, item: EvalItem) -> tuple[dict[str, str], dict[str, Any]]:
    """把一题的全部 session 回放进后端（命中缓存的跳过）。

    返回 (基线 message_id → 后端 message_id, 回放消耗统计)。session 按数据顺序回放，
    BranchMem 的 session 挂在其首个节点的父消息（已回放的）下面。"""
    ns = adapter.cache_namespace()
    to_backend: dict[str, str] = {}
    stats = {"replay_tokens_in": 0, "replay_tokens_out": 0, "replay_cost_usd": 0.0, "cache_hits": 0, "cache_misses": 0}
    for s in item.sessions:
        parent = s.get("parent_message_id")
        parent_backend = to_backend.get(parent) if parent else None
        key = session_cache_key(item, s, ns)
        r = cache.get(key)
        if r is None:
            r = adapter.replay_session(item, s, parent_backend)
            if len(r.message_ids) != len(s["turns"]):
                raise RuntimeError(f"回放 {s['session_id']} 返回 {len(r.message_ids)} 个 message_id，应为 {len(s['turns'])}")
            cache.put(key, r)
            cache.misses += 1
            stats["cache_misses"] += 1
            stats["replay_tokens_in"] += r.tokens_in
            stats["replay_tokens_out"] += r.tokens_out
            if r.cost_usd is not None:
                stats["replay_cost_usd"] += r.cost_usd
        else:
            cache.hits += 1
            stats["cache_hits"] += 1
        for t, mid in zip(s["turns"], r.message_ids):
            to_backend[t.message_id] = mid
    return to_backend, stats


class StubAdapter:
    """桩：在内存里记录回放的消息，ask 时用哈希词袋检索 + 抽取式回答。

    用途只有两个：跑通 run_eval 的 M/A* 流程（缓存、映射、分支过滤、引用开关），和让单测有确定输出。
    open_source、l4_profile 两个开关在桩里没有可模拟的行为，只影响 config_hash。"""

    name = "stub"

    def __init__(self) -> None:
        self.messages: dict[str, dict[str, Any]] = {}
        self.replay_calls = 0
        self.embedder = HashEmbedder()
        # 桩的消息只在内存里，跨进程的磁盘缓存不能复用，所以命名空间带实例标识
        self._token = f"{id(self):x}"

    def cache_namespace(self) -> str:
        return f"stub-v1-{self._token}"

    def start_item(self, item: EvalItem) -> None:
        return None

    def replay_session(self, item, session, parent_backend_id):
        self.replay_calls += 1
        ids = []
        parent = parent_backend_id
        for t in session["turns"]:
            if item.kind == "branchmem":
                mid = f"stub_{stable_int(item.key + '|' + t.message_id):016x}"
            else:
                mid = f"stub_{stable_int(session['session_id'] + '|' + str(t.turn_idx)):016x}"
            self.messages[mid] = {"content": t.content, "role": t.role, "date": t.date, "parent": parent, "branch_id": t.branch_id}
            ids.append(mid)
            parent = mid
        return ReplayResult(message_ids=ids)

    def _path(self, leaf: str | None) -> set[str]:
        out: set[str] = set()
        while leaf is not None and leaf in self.messages:
            out.add(leaf)
            leaf = self.messages[leaf]["parent"]
        return out

    def ask(self, item, *, parent_backend_id, to_backend, flags, k):
        visible_ids = [to_backend[t.message_id] for t in item.turns]
        if item.kind == "branchmem" and flags.branch_scope:
            path = self._path(parent_backend_id)
            visible_ids = [m for m in visible_ids if m in path]
        docs = [self.messages[m]["content"] for m in visible_ids]
        hits = top_k(item.question, docs, self.embedder, k)
        retrieved = [(visible_ids[i], s) for i, s in hits]
        if not hits or hits[0][1] <= 0:
            hyp, cited = "I don't know.", []
        else:
            hyp = docs[hits[0][0]]
            cited = [visible_ids[hits[0][0]]] if flags.citations else []
        branch = item.query_branch_id if item.kind == "branchmem" else None
        return AskResult(hyp, cited, retrieved, branch, tokens_in=0, tokens_out=0, latency_ms=0, cost_usd=None)


class MnemosyneBackendAdapter:
    """真实后端适配器（待 B2 的 Python API 合入后实现）。

    TODO(E, 等 B2)：对接方式定下来后实现下面四个方法，预期依赖（以 B2 实际交付为准，接口不得自造）：
      - start_item：为每题建一个项目（app.repo 建项目），记下 project_id；
      - replay_session：LongMemEval 每个 session 建一个对话、按 turns 顺序写入 user/assistant 消息
        （带 session 日期作为 created_at），BranchMem 在 parent_backend_id 下续写；然后同步跑记忆抽取
        （B3a 的 MemoryService.on_turn_finished → jobs），统计抽取用的 token 与费用；
      - ask：在新对话（LongMemEval）或 parent_backend_id 下（BranchMem）发问题，调用 B2 的 Agent 回合
        （非流式或收集 SSE 事件），按 Flags 关闭 open_source / 引用要求与引用校验 / 分支路径过滤 / L4 画像；
        从 message.end 与 citations 取回答、cited message_id，从检索步骤取 retrieved（message_id, score）；
      - cache_namespace：后端 git 提交号 + 数据库路径 + 记忆抽取模型名。
    """

    name = "backend"

    def __init__(self, **kwargs: Any) -> None:
        raise NotImplementedError(
            "系统 M/A1–A4 的真实后端适配器尚未实现：等 B2 交付 Python API 后接上（见 MnemosyneBackendAdapter 文档）。"
            "流水线自检请用 --adapter stub（结果不可用于论文）。"
        )


def make_adapter(name: str) -> Any:
    if name == "stub":
        return StubAdapter()
    if name == "backend":
        return MnemosyneBackendAdapter()
    raise ValueError(f"未知适配器：{name}")
