"""联网搜索的可配置提供方。没有配置（或缺密钥）时 search_web 工具不出现在工具清单里。

MN_WEB_SEARCH_PROVIDER：
- 空 / none（默认）：不提供 search_web。
- fake：测试用，返回固定结果，不联网。
- tavily：Tavily Search API，需要 MN_WEB_SEARCH_API_KEY（付费服务；本里程碑未实测，见 U73）。
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import httpx


class SearchError(Exception):
    pass


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str


def provider() -> str:
    p = os.environ.get("MN_WEB_SEARCH_PROVIDER", "").strip().lower()
    if p == "fake":
        return "fake"
    if p == "tavily" and os.environ.get("MN_WEB_SEARCH_API_KEY", "").strip():
        return "tavily"
    return "none"


def available() -> bool:
    return provider() != "none"


FAKE_RESULTS = [
    SearchResult("Fake result one", "https://example.org/fake/one", "A deterministic search result used in tests."),
    SearchResult("Fake result two", "https://example.org/fake/two", "Second deterministic search result."),
]


async def search(query: str, k: int = 5) -> list[SearchResult]:
    p = provider()
    if p == "fake":
        return FAKE_RESULTS[:k]
    if p == "tavily":
        key = os.environ.get("MN_WEB_SEARCH_API_KEY", "").strip()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    headers={"Authorization": f"Bearer {key}"},
                    json={"query": query, "max_results": k},
                )
        except httpx.HTTPError as e:
            raise SearchError(f"搜索服务连接失败：{type(e).__name__}") from e
        if resp.status_code >= 400:
            raise SearchError(f"搜索服务返回 HTTP {resp.status_code}")
        try:
            items = resp.json().get("results") or []
        except ValueError as e:
            raise SearchError("搜索服务响应格式不对") from e
        return [SearchResult(str(i.get("title") or ""), str(i.get("url") or ""), str(i.get("content") or "")[:300]) for i in items if i.get("url")][:k]
    raise SearchError("没有配置联网搜索")
