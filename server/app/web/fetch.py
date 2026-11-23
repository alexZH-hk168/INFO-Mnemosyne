"""网页抓取：下载网页、trafilatura 抽正文、存 web_snapshots，并在文件栏登记一条 kind=web 的 Document（契约 v0.2，原 U18）。

测试里用 monkeypatch 替换 `http_get`，不访问外网。
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import sqlite3
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from app.ids import new_id, now_iso, sha256_text
from app.ingest.tokenize import fts_tokens

MAX_BYTES = 5_000_000
MAX_TEXT = 200_000
PASSAGE_MAX = 600
USER_AGENT = "Mozilla/5.0 (compatible; Mnemosyne/0.1; +learning assistant)"


class FetchError(Exception):
    pass


@dataclass
class Snapshot:
    id: str
    document_id: str
    url: str
    title: str
    text: str
    sha256: str
    http_status: int


def check_url(url: str) -> str:
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise FetchError("只能抓取 http(s) 网址")
    host = u.hostname.lower()
    if host == "localhost" or host.endswith(".localhost"):
        raise FetchError("不能抓取本机地址")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return url.strip()
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
        raise FetchError("不能抓取内网地址")
    return url.strip()


async def http_get(url: str) -> tuple[int, str, str]:
    """返回 (HTTP 状态码, 最终网址, HTML 文本)。超过 5 MB 截断。"""
    async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(20.0), headers={"User-Agent": USER_AGENT}) as client:
        async with client.stream("GET", url) as resp:
            buf = bytearray()
            async for block in resp.aiter_bytes():
                buf.extend(block)
                if len(buf) >= MAX_BYTES:
                    break
            enc = resp.encoding or "utf-8"
            return resp.status_code, str(resp.url), bytes(buf).decode(enc, errors="replace")


def _html_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    return " ".join(m.group(1).split()) if m else ""


def extract(html: str, url: str) -> tuple[str, str]:
    """trafilatura 抽正文与标题。"""
    import trafilatura

    text = trafilatura.extract(html, url=url, include_comments=False, include_tables=True, output_format="txt") or ""
    title = ""
    try:
        meta = trafilatura.extract_metadata(html, default_url=url)
        title = (meta.title or "") if meta else ""
    except Exception:  # noqa: BLE001 - 元数据失败不影响正文
        title = ""
    return (title or _html_title(html) or urlparse(url).hostname or url), text[:MAX_TEXT]


def save_snapshot(conn: sqlite3.Connection, *, project_id: str, url: str, title: str, text: str, http_status: int) -> Snapshot:
    sid = new_id("ws")
    did = new_id("doc")
    now = now_iso()
    digest = sha256_text(text)
    conn.execute(
        "INSERT INTO web_snapshots (id, url, title, fetched_at, text, sha256, http_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (sid, url, title, now, text, digest, http_status),
    )
    conn.execute(
        'INSERT INTO documents (id, project_id, kind, "group", title, path, sha256, snapshot_id, parse_status, created_at) '
        "VALUES (?, ?, 'web', 'web', ?, NULL, ?, ?, 'ready', ?)",
        (did, project_id, title, digest, sid, now),
    )
    conn.commit()
    return Snapshot(sid, did, url, title, text, digest, http_status)


async def fetch_snapshot(conn: sqlite3.Connection, *, project_id: str, url: str) -> Snapshot:
    url = check_url(url)
    try:
        status, final_url, html = await http_get(url)
    except httpx.HTTPError as e:
        raise FetchError(f"网页下载失败：{type(e).__name__}") from e
    if status >= 400:
        raise FetchError(f"网页返回 HTTP {status}")
    title, text = await asyncio.to_thread(extract, html, final_url)
    if not text.strip():
        raise FetchError("没有抽取到网页正文")
    return save_snapshot(conn, project_id=project_id, url=final_url, title=title, text=text, http_status=status)


def paragraphs(text: str) -> list[tuple[int, int]]:
    spans = []
    pos = 0
    for part in text.split("\n"):
        s, e = pos, pos + len(part)
        pos = e + 1
        while s < e and text[s].isspace():
            s += 1
        while e > s and text[e - 1].isspace():
            e -= 1
        if e > s:
            spans.append((s, e))
    return spans


def pick_passages(text: str, query: str, k: int = 3) -> list[tuple[int, int]]:
    """按与查询的词重叠挑至多 k 段（码点偏移，左闭右开），按原文顺序返回；都不重叠时取第一段。"""
    spans = paragraphs(text)
    if not spans:
        return []
    qt = set(fts_tokens(query or ""))
    scored = []
    for s, e in spans:
        pt = set(fts_tokens(text[s:e]))
        score = len(qt & pt) / (len(pt) ** 0.5) if pt and qt else 0.0
        scored.append((score, s, e))
    best = [x for x in sorted(scored, key=lambda x: (-x[0], x[1])) if x[0] > 0][:k] or [(0.0, *spans[0])]
    out = []
    for _, s, e in sorted(best, key=lambda x: x[1]):
        out.append((s, min(e, s + PASSAGE_MAX)))
    return out
