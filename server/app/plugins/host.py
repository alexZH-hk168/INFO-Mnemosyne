"""插件进程宿主：一个后台线程跑独立的 asyncio 事件循环，持有全部 MCP 会话。

为什么单独开线程：MCP 会话（官方 `mcp` SDK 2.x 的 `Client`）基于 anyio 任务组，必须在同一个任务里进入与退出，
而调用方可能是 FastAPI 的同步路由（线程池）、Agent 回合的异步代码，或测试里各自的事件循环。
把会话都放在这一个循环里，调用方通过 `run_sync` / `run_async` 提交协程即可，不受调用方循环的生命周期影响。

规则（契约 plugin-manifest.md）：
- 每个插件一个会话，stdio（`uvx`/`npx` 等命令拉起子进程）或 http（Streamable HTTP 地址）。
- 握手用 legacy `initialize`（上游插件多为 1.x SDK；2.x 服务端也兼容）。
- 空闲（无进行中调用且超过 `MN_PLUGIN_IDLE_S`，默认 600 s）即关闭会话并结束进程。
- 单次工具调用超时由调用方给（默认 30 s），超时抛 `PluginCallTimeout`，会话保留。
- 启动参数（命令、参数、环境）变化时自动重启会话；进程中途退出时标记失效，下次调用重启。
- 插件 stderr 写入日志文件，自检失败时取末尾若干行作为 `log_tail`。
"""

from __future__ import annotations

import asyncio
import atexit
import concurrent.futures
import hashlib
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("mnemosyne.plugins")

DEFAULT_IDLE_S = 600.0
DEFAULT_START_TIMEOUT_S = 30.0
DEFAULT_CALL_TIMEOUT_S = 30.0
LOG_TAIL_LINES = 20


class PluginStartError(Exception):
    """启动、握手或 tools/list 失败。"""

    def __init__(self, message: str, log_tail: str = ""):
        super().__init__(message)
        self.message = message
        self.log_tail = log_tail


class PluginCallTimeout(Exception):
    pass


class PluginCallError(Exception):
    pass


@dataclass(frozen=True)
class LaunchSpec:
    plugin_id: str
    transport: str  # 'stdio' | 'http'
    command: str
    args: tuple[str, ...] = ()
    env: tuple[tuple[str, str], ...] = ()
    url: str | None = None
    log_path: str = ""

    def fingerprint(self) -> str:
        data = json.dumps([self.transport, self.command, list(self.args), sorted(self.env), self.url], ensure_ascii=False)
        return hashlib.sha256(data.encode("utf-8")).hexdigest()


@dataclass
class ToolInfo:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class RawResult:
    text: str
    structured: Any = None
    is_error: bool = False


@dataclass(eq=False)
class _Session:
    spec: LaunchSpec
    ready: asyncio.Future
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    client: Any = None
    task: asyncio.Task | None = None
    last_used: float = field(default_factory=time.monotonic)
    inflight: int = 0
    tools: list[ToolInfo] | None = None
    dead: bool = False


def _leaf_exception(exc: BaseException) -> BaseException:
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return exc


def _describe(exc: BaseException) -> str:
    leaf = _leaf_exception(exc)
    text = str(leaf).strip()
    return f"{type(leaf).__name__}: {text}" if text else type(leaf).__name__


def read_log_tail(path: str, lines: int = LOG_TAIL_LINES) -> str:
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 8192))
            data = f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""
    return "\n".join(data.splitlines()[-lines:])


def content_to_text(content: list[Any]) -> str:
    """CallToolResult.content → 文本。非文本内容只留占位说明。"""
    parts: list[str] = []
    for c in content or []:
        kind = getattr(c, "type", "")
        if kind == "text":
            parts.append(getattr(c, "text", ""))
        elif kind == "image":
            parts.append("[图片内容，未展示]")
        elif kind == "audio":
            parts.append("[音频内容，未展示]")
        elif kind == "resource":
            res = getattr(c, "resource", None)
            text = getattr(res, "text", None)
            parts.append(text if isinstance(text, str) else f"[资源 {getattr(res, 'uri', '')}]")
        elif kind == "resource_link":
            parts.append(f"[资源链接 {getattr(c, 'uri', '')}]")
    return "\n".join(p for p in parts if p)


class PluginHost:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._sessions: dict[str, _Session] = {}

    # ---------- 线程与循环 ----------
    @staticmethod
    def idle_s() -> float:
        try:
            return float(os.environ.get("MN_PLUGIN_IDLE_S", DEFAULT_IDLE_S))
        except ValueError:
            return DEFAULT_IDLE_S

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._lock:
            if self._loop is not None and self._thread is not None and self._thread.is_alive():
                return self._loop
            loop = asyncio.new_event_loop()
            thread = threading.Thread(target=self._run_loop, args=(loop,), name="mnemosyne-plugins", daemon=True)
            thread.start()
            self._loop, self._thread = loop, thread
            asyncio.run_coroutine_threadsafe(self._reaper(), loop)
            return loop

    @staticmethod
    def _run_loop(loop: asyncio.AbstractEventLoop) -> None:
        asyncio.set_event_loop(loop)
        loop.run_forever()

    def submit(self, coro) -> concurrent.futures.Future:
        return asyncio.run_coroutine_threadsafe(coro, self._ensure_loop())

    def run_sync(self, coro, timeout: float | None = None):
        return self.submit(coro).result(timeout)

    async def run_async(self, coro):
        return await asyncio.wrap_future(self.submit(coro))

    # ---------- 会话 ----------
    async def _owner(self, s: _Session) -> None:
        from mcp import Client
        from mcp.client.stdio import StdioServerParameters, stdio_client

        spec = s.spec
        errlog = None
        try:
            if spec.transport == "stdio":
                Path(spec.log_path).parent.mkdir(parents=True, exist_ok=True)
                errlog = open(spec.log_path, "w", encoding="utf-8", errors="replace")  # noqa: SIM115
                params = StdioServerParameters(command=spec.command, args=list(spec.args), env=dict(spec.env) or None)
                client = Client(stdio_client(params, errlog=errlog), mode="legacy", cache=None)
            elif spec.transport == "http":
                client = Client(spec.url or spec.command, mode="legacy", cache=None)
            else:
                raise ValueError(f"不支持的 transport：{spec.transport}")
            async with client:
                s.client = client
                if not s.ready.done():
                    s.ready.set_result(None)
                await s.stop.wait()
        except asyncio.CancelledError:
            if not s.ready.done():
                s.ready.set_exception(PluginStartError("插件启动被取消"))
            raise
        except BaseException as e:  # noqa: BLE001  任务组会把子任务异常包成 ExceptionGroup
            if not s.ready.done():
                s.ready.set_exception(PluginStartError(_describe(e)))
            else:
                log.warning("插件 %s 会话异常结束：%s", spec.plugin_id, _describe(e))
        finally:
            s.dead = True
            s.client = None
            if errlog is not None:
                errlog.close()

    async def _close(self, s: _Session) -> None:
        if self._sessions.get(s.spec.plugin_id) is s:
            del self._sessions[s.spec.plugin_id]
        s.stop.set()
        if s.task is not None and not s.task.done():
            try:
                await asyncio.wait_for(asyncio.shield(s.task), 10)
            except (asyncio.TimeoutError, Exception):  # noqa: BLE001
                s.task.cancel()
                try:
                    await asyncio.wait_for(s.task, 5)
                except BaseException:  # noqa: BLE001
                    pass
        if not s.ready.done():
            s.ready.cancel()
        # 读取一次异常，避免 “Future exception was never retrieved”
        if s.ready.done() and not s.ready.cancelled():
            s.ready.exception()

    async def _session(self, spec: LaunchSpec, start_timeout: float) -> _Session:
        s = self._sessions.get(spec.plugin_id)
        if s is not None and (s.dead or s.spec.fingerprint() != spec.fingerprint()):
            await self._close(s)
            s = None
        if s is None:
            loop = asyncio.get_running_loop()
            s = _Session(spec=spec, ready=loop.create_future())
            self._sessions[spec.plugin_id] = s
            s.task = asyncio.create_task(self._owner(s), name=f"plugin:{spec.plugin_id}")
        try:
            await asyncio.wait_for(asyncio.shield(s.ready), start_timeout)
        except asyncio.TimeoutError:
            await self._close(s)
            raise PluginStartError(f"插件启动后 {start_timeout:g} s 内没有完成握手", read_log_tail(spec.log_path)) from None
        except PluginStartError as e:
            await self._close(s)
            raise PluginStartError(f"插件启动失败：{e.message}", read_log_tail(spec.log_path)) from None
        if s.dead:
            await self._close(s)
            raise PluginStartError("插件进程已退出", read_log_tail(spec.log_path))
        s.last_used = time.monotonic()
        return s

    async def _list_tools(self, s: _Session, timeout: float) -> list[ToolInfo]:
        if s.tools is None:
            tools: list[ToolInfo] = []
            cursor = None
            for _ in range(50):
                res = await asyncio.wait_for(s.client.list_tools(cursor=cursor), timeout)
                for t in res.tools:
                    tools.append(ToolInfo(t.name, t.description or "", dict(t.input_schema or {"type": "object"})))
                cursor = res.next_cursor
                if not cursor:
                    break
            s.tools = tools
        s.last_used = time.monotonic()
        return s.tools

    async def _self_check(self, spec: LaunchSpec, timeout: float) -> list[ToolInfo]:
        deadline = time.monotonic() + timeout
        s = await self._session(spec, timeout)
        s.tools = None  # 自检总是重新 tools/list
        try:
            return await self._list_tools(s, max(0.1, deadline - time.monotonic()))
        except asyncio.TimeoutError:
            await self._close(s)
            raise PluginStartError(f"tools/list 在 {timeout:g} s 内没有返回", read_log_tail(spec.log_path)) from None
        except Exception as e:  # noqa: BLE001
            await self._close(s)
            raise PluginStartError(f"tools/list 失败：{_describe(e)}", read_log_tail(spec.log_path)) from None

    async def _tools(self, spec: LaunchSpec, timeout: float) -> list[ToolInfo]:
        s = await self._session(spec, timeout)
        try:
            return await self._list_tools(s, timeout)
        except Exception as e:  # noqa: BLE001
            await self._close(s)
            raise PluginStartError(f"tools/list 失败：{_describe(e)}", read_log_tail(spec.log_path)) from None

    async def _call(self, spec: LaunchSpec, tool: str, arguments: dict, timeout: float, start_timeout: float) -> RawResult:
        from mcp import MCPError

        s = await self._session(spec, start_timeout)
        s.inflight += 1
        try:
            res = await asyncio.wait_for(s.client.call_tool(tool, arguments), timeout)
        except asyncio.TimeoutError:
            raise PluginCallTimeout(f"{spec.plugin_id}__{tool} 超过 {timeout:g} s 没有返回") from None
        except MCPError as e:  # 协议层错误（如未知工具、参数不合法），会话仍可用
            raise PluginCallError(f"插件返回错误：{e}") from None
        except Exception as e:  # noqa: BLE001  连接断开等：会话作废，下次重启
            s.dead = True
            raise PluginCallError(f"插件调用失败：{_describe(e)}") from None
        finally:
            s.inflight -= 1
            s.last_used = time.monotonic()
            if s.dead and s.inflight == 0:
                asyncio.get_running_loop().create_task(self._close(s))
        structured = getattr(res, "structured_content", None)
        return RawResult(text=content_to_text(res.content), structured=structured, is_error=bool(res.is_error))

    async def _reaper(self) -> None:
        while True:
            # 每秒检查一次（空闲时长可在运行中改，测试里调小）
            await asyncio.sleep(min(1.0, max(0.1, self.idle_s() / 4)))
            now = time.monotonic()
            for s in list(self._sessions.values()):
                if s.inflight == 0 and s.ready.done() and now - s.last_used > self.idle_s():
                    log.info("插件 %s 空闲超过 %.0f s，关闭会话", s.spec.plugin_id, self.idle_s())
                    await self._close(s)

    async def _stop(self, plugin_id: str | None) -> None:
        targets = list(self._sessions.values()) if plugin_id is None else [s for s in self._sessions.values() if s.spec.plugin_id == plugin_id]
        await asyncio.gather(*(self._close(s) for s in targets), return_exceptions=True)

    # ---------- 对外接口（任意线程 / 任意事件循环） ----------
    def self_check(self, spec: LaunchSpec, timeout: float = DEFAULT_START_TIMEOUT_S) -> list[ToolInfo]:
        return self.run_sync(self._self_check(spec, timeout), timeout + 30)

    async def tools(self, spec: LaunchSpec, timeout: float = DEFAULT_START_TIMEOUT_S) -> list[ToolInfo]:
        return await self.run_async(self._tools(spec, timeout))

    async def call(
        self, spec: LaunchSpec, tool: str, arguments: dict, timeout: float = DEFAULT_CALL_TIMEOUT_S,
        start_timeout: float = DEFAULT_START_TIMEOUT_S,
    ) -> RawResult:
        return await self.run_async(self._call(spec, tool, arguments, timeout, start_timeout))

    def stop(self, plugin_id: str) -> None:
        if self._loop is None:
            return
        self.run_sync(self._stop(plugin_id), 30)

    def shutdown(self) -> None:
        """关闭全部会话（结束子进程）；事件循环线程保留，之后还能再用。"""
        if self._loop is None or self._thread is None or not self._thread.is_alive():
            return
        try:
            self.run_sync(self._stop(None), 30)
        except Exception:  # noqa: BLE001
            log.exception("关闭插件会话失败")

    def running(self) -> list[str]:
        return sorted(pid for pid, s in self._sessions.items() if not s.dead and s.ready.done() and not s.ready.cancelled() and s.ready.exception() is None)


host = PluginHost()
atexit.register(host.shutdown)
