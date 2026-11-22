"""运行配置：全部从环境变量读取（每次调用重新读，便于测试切换）。

嵌入模型（契约 Settings.embedding_model 对应的服务端实现）：
- MN_EMBED_BACKEND=fake（默认）：确定性本地假嵌入器，不联网、不下载权重，仅用于开发与测试。
- MN_EMBED_BACKEND=openai：OpenAI 兼容 `/v1/embeddings`，需要
  MN_EMBED_API_BASE（如 https://api.openai.com/v1）、MN_EMBED_MODEL、MN_EMBED_API_KEY、MN_EMBED_DIM。
切换后向量维度可能变化，需运行 `scripts/ingest.py --reindex` 重建向量表。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Config:
    data_dir: Path
    db_path: Path
    embed_backend: str
    embed_api_base: str
    embed_model: str
    embed_api_key: str
    embed_dim: int
    worker_enabled: bool
    soffice: str

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"


def get_config() -> Config:
    data_dir = Path(os.environ.get("MN_DATA_DIR", str(SERVER_DIR / "data")))
    db_path = Path(os.environ.get("MN_DB_PATH", str(data_dir / "mnemosyne.db")))
    backend = os.environ.get("MN_EMBED_BACKEND", "fake").strip().lower() or "fake"
    default_dim = "256" if backend == "fake" else "0"
    return Config(
        data_dir=data_dir,
        db_path=db_path,
        embed_backend=backend,
        embed_api_base=os.environ.get("MN_EMBED_API_BASE", "").rstrip("/"),
        embed_model=os.environ.get("MN_EMBED_MODEL", "fake-hash-256" if backend == "fake" else ""),
        embed_api_key=os.environ.get("MN_EMBED_API_KEY", ""),
        embed_dim=int(os.environ.get("MN_EMBED_DIM", default_dim) or 0),
        worker_enabled=os.environ.get("MN_WORKER", "1") != "0",
        soffice=os.environ.get("MN_SOFFICE", "/usr/bin/soffice"),
    )
