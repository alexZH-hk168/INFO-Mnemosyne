"""Skill 服务：模块级对象 `skills` 实现 `app.agent.hooks.SkillService`（list_enabled、load），
另提供 `/api/skills*` 用的方法。

- Skill 是一个目录，根下必须有 SKILL.md，头部必须有 name 与 description（license 可选），
  缺失返回 SKILL_INVALID（契约 plugin-manifest.md）。name 按 Agent Skills 约定：小写字母、数字、连字符，≤ 64 字符。
- 导入：本机目录（复制到 Skill 目录）或 GitHub 目录（经 GitHub contents API 逐个下载文件；有文件数与总大小上限）。
  Skill 目录默认 `~/.mnemosyne/skills/<name>`，可用 `MN_SKILLS_DIR` 覆盖。
- 渐进加载：系统提示只放已启用 Skill 的 name + description（list_enabled）；`load` 返回 SKILL.md 正文与目录内其他文件清单。
- 附带脚本 v1 不执行（U4），本模块只读写文件，不运行目录里的任何东西。
"""

from __future__ import annotations

import os
import re
import shutil
import sqlite3
import uuid
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx

from app.errors import ApiError, not_found
from app.plugins import registry
from app.skills.frontmatter import FrontMatterError, parse, split

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_FILES = 200
MAX_BYTES = 10 * 1024 * 1024
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv"}


def skills_dir() -> Path:
    return Path(os.path.expanduser(os.environ.get("MN_SKILLS_DIR", "~/.mnemosyne/skills")))


def display_path(p: str | Path) -> str:
    s = str(p)
    home = os.path.expanduser("~")
    if home and home != "~" and (s == home or s.startswith(home + os.sep)):
        return "~" + s[len(home):]
    return s


def invalid(msg: str) -> ApiError:
    return ApiError("SKILL_INVALID", msg)


def read_meta(d: Path) -> tuple[dict, str]:
    """校验 Skill 目录，返回（头部字段，正文）。"""
    md = d / "SKILL.md"
    if not md.is_file():
        raise invalid("目录里没有 SKILL.md")
    try:
        header, body = split(md.read_text(encoding="utf-8"))
    except UnicodeDecodeError:
        raise invalid("SKILL.md 不是 UTF-8 文本") from None
    except FrontMatterError as e:
        raise invalid(str(e)) from None
    meta = parse(header)
    for key in ("name", "description"):
        if not (meta.get(key) or "").strip():
            raise invalid(f"SKILL.md 头部缺少 {key}")
    name = meta["name"].strip()
    if len(name) > 64 or not NAME_RE.match(name):
        raise invalid("SKILL.md 的 name 只能用小写字母、数字和连字符（不超过 64 个字符）")
    return meta, body


def files_of(d: Path) -> list[str]:
    out: list[str] = []
    for root, dirs, files in os.walk(d):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        for f in sorted(files):
            out.append(str((Path(root) / f).relative_to(d)))
            if len(out) >= MAX_FILES:
                break
    rest = sorted(x for x in out if x != "SKILL.md")
    return (["SKILL.md"] if "SKILL.md" in out else []) + rest


def copy_tree(src: Path, dst: Path) -> None:
    count = 0
    size = 0
    for root, dirs, files in os.walk(src):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not (Path(root) / x).is_symlink()]
        for f in files:
            sp = Path(root) / f
            if sp.is_symlink() or not sp.is_file():
                continue
            count += 1
            size += sp.stat().st_size
            if count > MAX_FILES or size > MAX_BYTES:
                raise ApiError("VALIDATION_ERROR", f"Skill 目录太大（上限 {MAX_FILES} 个文件、{MAX_BYTES // 1024 // 1024} MB）")
            dp = dst / sp.relative_to(src)
            dp.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(sp, dp)


# ---------- GitHub ----------
def parse_github_url(url: str) -> tuple[str, str, str, str]:
    """https://github.com/<owner>/<repo>[/tree/<ref>/<path>] → (owner, repo, ref, path)；ref 为空表示默认分支。

    ref 中含斜杠的分支名无法与路径区分，按第一段当 ref。
    """
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or u.netloc.lower() not in ("github.com", "www.github.com"):
        raise ApiError("VALIDATION_ERROR", "只支持 https://github.com/ 开头的目录地址")
    parts = [p for p in u.path.split("/") if p]
    if len(parts) < 2:
        raise ApiError("VALIDATION_ERROR", "GitHub 地址缺少 owner/repo")
    owner, repo = parts[0], parts[1].removesuffix(".git")
    ref, path = "", ""
    if len(parts) >= 4 and parts[2] in ("tree", "blob"):
        ref = parts[3]
        path = "/".join(parts[4:])
        if parts[2] == "blob" and path.endswith("SKILL.md"):
            path = path[: -len("SKILL.md")].rstrip("/")
    elif len(parts) > 2:
        raise ApiError("VALIDATION_ERROR", "GitHub 地址格式应为 https://github.com/<owner>/<repo>/tree/<分支>/<目录>")
    return owner, repo, ref, path


def fetch_github(url: str, dest: Path) -> None:
    """把 GitHub 目录下载到 dest（经 contents API；未登录限额 60 次/小时）。测试里替换成本地复制。"""
    owner, repo, ref, path = parse_github_url(url)
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "mnemosyne-skill-import"}
    token = os.environ.get("MN_GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    state = {"files": 0, "bytes": 0}
    with httpx.Client(timeout=20, headers=headers, follow_redirects=True) as client:

        def walk(rel: str) -> None:
            api = f"https://api.github.com/repos/{owner}/{repo}/contents/{quote(rel)}"
            r = client.get(api, params={"ref": ref} if ref else None)
            if r.status_code == 404:
                raise ApiError("VALIDATION_ERROR", f"GitHub 上找不到 {owner}/{repo}/{rel}")
            r.raise_for_status()
            entries = r.json()
            if isinstance(entries, dict):
                entries = [entries]
            for e in entries:
                sub = e["path"][len(path):].lstrip("/") if path else e["path"]
                if e["type"] == "dir":
                    if e["name"] not in SKIP_DIRS:
                        walk(e["path"])
                elif e["type"] == "file" and e.get("download_url"):
                    state["files"] += 1
                    state["bytes"] += int(e.get("size") or 0)
                    if state["files"] > MAX_FILES or state["bytes"] > MAX_BYTES:
                        raise ApiError("VALIDATION_ERROR", f"Skill 目录太大（上限 {MAX_FILES} 个文件、{MAX_BYTES // 1024 // 1024} MB）")
                    fr = client.get(e["download_url"])
                    fr.raise_for_status()
                    target = dest / (sub or e["name"])
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(fr.content)

        walk(path)


class SkillService:
    # ---------- hooks.SkillService ----------
    def list_enabled(self, conn: sqlite3.Connection, *, project_id: str) -> list[dict[str, str]]:
        """Skill 不分项目（data-model 的 skills 表没有项目列），project_id 只为接口一致。"""
        rows = conn.execute("SELECT id, name, description FROM skills WHERE enabled = 1 ORDER BY name").fetchall()
        return [{"id": r["id"], "name": r["name"], "summary": r["description"]} for r in rows]

    def load(self, conn: sqlite3.Connection, *, skill_id: str) -> str:
        row = conn.execute("SELECT * FROM skills WHERE id = ? OR name = ?", (skill_id, skill_id)).fetchone()
        if row is None or not row["enabled"]:
            return ""
        d = Path(row["dir_path"])
        try:
            _, body = split((d / "SKILL.md").read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, FrontMatterError):
            return ""
        out = f"# Skill：{row['name']}\n\n{body.strip()}\n"
        others = [f for f in files_of(d) if f != "SKILL.md"]
        if others:
            out += (
                "\n---\n本 Skill 目录里的其他文件（正文提到时再按需读取；附带脚本在 Mnemosyne v1 中不执行）：\n"
                + "\n".join(f"- {f}" for f in others)
                + "\n"
            )
        return out

    # ---------- 接口 ----------
    @staticmethod
    def out(row: sqlite3.Row) -> dict:
        item = {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "dir_path": display_path(row["dir_path"]),
            "enabled": bool(row["enabled"]),
        }
        if row["source_url"]:
            item["source_url"] = row["source_url"]
        if row["license"]:
            item["license"] = row["license"]
        return item

    def list(self, conn: sqlite3.Connection) -> list[dict]:
        return [self.out(r) for r in conn.execute("SELECT * FROM skills ORDER BY rowid").fetchall()]

    def _row_or_404(self, conn: sqlite3.Connection, skill_id: str) -> sqlite3.Row:
        row = conn.execute("SELECT * FROM skills WHERE id = ?", (skill_id,)).fetchone()
        if row is None:
            raise not_found("Skill ")
        return row

    def get(self, conn: sqlite3.Connection, skill_id: str) -> dict:
        row = self._row_or_404(conn, skill_id)
        d = Path(row["dir_path"])
        try:
            skill_md = (d / "SKILL.md").read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            skill_md = ""
        return {**self.out(row), "skill_md": skill_md, "files": files_of(d) if d.is_dir() else []}

    def set_enabled(self, conn: sqlite3.Connection, skill_id: str, enabled: bool) -> dict:
        self._row_or_404(conn, skill_id)
        conn.execute("UPDATE skills SET enabled = ? WHERE id = ?", (1 if enabled else 0, skill_id))
        conn.commit()
        return self.out(self._row_or_404(conn, skill_id))

    def import_(self, conn: sqlite3.Connection, source: str, url: str | None, path: str | None) -> dict:
        base = skills_dir()
        base.mkdir(parents=True, exist_ok=True)
        tmp = base / f".import-{uuid.uuid4().hex[:12]}"
        try:
            if source == "local":
                if not path:
                    raise ApiError("VALIDATION_ERROR", "本机导入需要 path")
                src = Path(os.path.expanduser(path))
                if not src.is_dir():
                    raise ApiError("VALIDATION_ERROR", f"目录不存在：{path}")
                meta, _ = read_meta(src)
                source_url = None
                dst = base / meta["name"].strip()
                if src.resolve() != dst.resolve():
                    copy_tree(src, tmp)
                    read_meta(tmp)
                    self._replace(tmp, dst)
            else:
                if not url:
                    raise ApiError("VALIDATION_ERROR", "GitHub 导入需要 url")
                parse_github_url(url)
                tmp.mkdir(parents=True)
                try:
                    fetch_github(url, tmp)
                except httpx.HTTPError as e:
                    raise ApiError("INTERNAL", f"从 GitHub 下载失败：{e}") from e
                meta, _ = read_meta(tmp)
                source_url = url.strip()
                dst = base / meta["name"].strip()
                self._replace(tmp, dst)
        finally:
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)
        name = meta["name"].strip()
        license_ = (meta.get("license") or "").strip() or None
        if license_ is None and source_url:
            entry = registry.skill_entry_by_url(source_url)
            license_ = entry.get("license") if entry else None
        old = conn.execute("SELECT enabled FROM skills WHERE id = ?", (name,)).fetchone()
        conn.execute(
            """INSERT INTO skills (id, name, description, dir_path, source_url, license, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
                 dir_path = excluded.dir_path, source_url = excluded.source_url, license = excluded.license""",
            (name, name, meta["description"].strip(), str(dst), source_url, license_, old["enabled"] if old else 1),
        )
        conn.commit()
        return self.out(self._row_or_404(conn, name))

    @staticmethod
    def _replace(tmp: Path, dst: Path) -> None:
        if dst.exists():
            shutil.rmtree(dst)
        tmp.rename(dst)


skills = SkillService()
