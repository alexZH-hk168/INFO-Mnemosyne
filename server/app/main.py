"""Mnemosyne 后端入口：`uv run uvicorn app.main:app --port 8100`。"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import market, materials, plugins, projects, skills
from app.api import messages as messages_api  # B2
from app.api import settings as settings_api  # B2
from app.config import get_config
from app.db.conn import connect, init_db
from app.errors import install_error_handlers
from app.ingest.pipeline import ParseWorker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = get_config()
    conn = connect(config.db_path)
    try:
        init_db(conn, config)
    finally:
        conn.close()
    worker = None
    if config.worker_enabled:
        worker = ParseWorker(config.db_path)
        worker.start()
    app.state.worker = worker
    try:
        yield
    finally:
        if worker is not None:
            worker.stop()
            worker.join(timeout=10)
        # U94：服务关闭时结束插件子进程
        from app.plugins.runtime import plugins

        plugins.shutdown()


def create_app() -> FastAPI:
    app = FastAPI(title="Mnemosyne", version="0.1.0", lifespan=lifespan)
    install_error_handlers(app)
    app.include_router(projects.router, prefix="/api")
    app.include_router(materials.router, prefix="/api")
    # B3b：市场、插件、Skill
    app.include_router(market.router, prefix="/api")
    app.include_router(plugins.router, prefix="/api")
    app.include_router(skills.router, prefix="/api")
    app.include_router(messages_api.router, prefix="/api")  # B2
    app.include_router(settings_api.router, prefix="/api")  # B2
    return app


app = create_app()
