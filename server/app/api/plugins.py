"""插件接口：`/api/plugins*` 与 `/api/conversations/{cid}/plugins`（契约 rest-api.md“市场、插件与 Skill”）。"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.api.deps import get_conn
from app.errors import ApiError
from app.models import dump
from app.plugins import schemas as s
from app.plugins.runtime import plugins

router = APIRouter()


@router.get("/plugins")
def list_plugins(conn: sqlite3.Connection = Depends(get_conn)):
    try:
        items = plugins.list_installed(conn)
    except sqlite3.Error as e:
        raise ApiError("INTERNAL", "读取已安装插件失败") from e
    return dump(s.InstalledPluginList(plugins=items))


@router.get("/plugins/{plugin_id}")
def get_plugin(plugin_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.PluginDetail(**plugins.detail(conn, plugin_id)))


@router.post("/plugins/{plugin_id}")
def install_plugin(plugin_id: str, body: s.InstallPluginBody, conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.InstalledPlugin(**plugins.install(conn, plugin_id, body.config)))


@router.delete("/plugins/{plugin_id}")
def uninstall_plugin(plugin_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.OkResult(**plugins.uninstall(conn, plugin_id)))


@router.get("/conversations/{cid}/plugins")
def get_conversation_plugins(cid: str, conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.ConversationPluginList(plugins=plugins.conversation_plugins(conn, cid)))


@router.put("/conversations/{cid}/plugins")
def put_conversation_plugins(cid: str, body: s.PutConversationPluginsBody, conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.ConversationPluginList(plugins=plugins.set_conversation_plugins(conn, cid, body.enabled_plugin_ids)))
