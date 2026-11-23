"""Skill 接口：`/api/skills*`（契约 rest-api.md“市场、插件与 Skill”）。"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from app.api.deps import get_conn
from app.errors import ApiError
from app.models import dump
from app.plugins import schemas as s
from app.skills.service import skills

router = APIRouter()


@router.get("/skills")
def list_skills(conn: sqlite3.Connection = Depends(get_conn)):
    try:
        items = skills.list(conn)
    except sqlite3.Error as e:
        raise ApiError("INTERNAL", "读取 Skill 列表失败") from e
    return dump(s.SkillList(skills=items))


@router.post("/skills/import")
def import_skill(body: s.SkillImportBody, conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.Skill(**skills.import_(conn, body.source, body.url, body.path)))


@router.get("/skills/{skill_id}")
def get_skill(skill_id: str, conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.SkillDetail(**skills.get(conn, skill_id)))


@router.put("/skills/{skill_id}")
def put_skill(skill_id: str, body: s.PutSkillBody, conn: sqlite3.Connection = Depends(get_conn)):
    return dump(s.Skill(**skills.set_enabled(conn, skill_id, body.enabled)))
