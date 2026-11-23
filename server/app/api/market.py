"""市场接口：`/api/market/plugins`、`/api/market/skills`，条目来自 server/registry/*.json（build_registry.py 生成）。"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.api.deps import get_conn
from app.models import dump
from app.plugins import schemas as s
from app.plugins.runtime import plugins

router = APIRouter()


@router.get("/market/plugins")
def market_plugins(conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.MarketList(items=plugins.market(conn, "plugin")))


@router.get("/market/skills")
def market_skills(conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.MarketList(items=plugins.market(conn, "skill")))
