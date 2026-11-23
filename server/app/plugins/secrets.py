"""插件配置里的密钥加密存储（data-model：config_json 中 API Key 加密存储）。

只用标准库：密钥文件 `<data_dir>/secret.key`（32 字节随机数，权限 0600）；
每个值用 HMAC-SHA256 计数器模式生成密钥流异或加密，再对 nonce+密文做 HMAC-SHA256 认证（encrypt-then-MAC）。
加密与认证使用由主密钥派生的两把不同子密钥。存储格式：`enc:v1:<base64(nonce16 + 密文 + tag32)>`。
这只防止数据库文件单独泄露时直接看到明文；拿到整个数据目录（含 secret.key）仍可解密。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from pathlib import Path

from app.config import get_config

PREFIX = "enc:v1:"


def _master_key() -> bytes:
    path: Path = get_config().data_dir / "secret.key"
    if path.exists():
        data = path.read_bytes()
        if len(data) == 32:
            return data
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    return key


def _subkeys() -> tuple[bytes, bytes]:
    mk = _master_key()
    return hmac.new(mk, b"mnemosyne-enc", hashlib.sha256).digest(), hmac.new(mk, b"mnemosyne-mac", hashlib.sha256).digest()


def _stream(key: bytes, nonce: bytes, n: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < n:
        out += hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:n])


def encrypt(plain: str) -> str:
    ek, mk = _subkeys()
    nonce = secrets.token_bytes(16)
    data = plain.encode("utf-8")
    ct = bytes(a ^ b for a, b in zip(data, _stream(ek, nonce, len(data))))
    tag = hmac.new(mk, nonce + ct, hashlib.sha256).digest()
    return PREFIX + base64.b64encode(nonce + ct + tag).decode("ascii")


def decrypt(stored: str) -> str:
    if not stored.startswith(PREFIX):
        return stored
    raw = base64.b64decode(stored[len(PREFIX):])
    nonce, ct, tag = raw[:16], raw[16:-32], raw[-32:]
    ek, mk = _subkeys()
    if not hmac.compare_digest(tag, hmac.new(mk, nonce + ct, hashlib.sha256).digest()):
        raise ValueError("密钥校验失败（secret.key 与数据库不匹配）")
    return bytes(a ^ b for a, b in zip(ct, _stream(ek, nonce, len(ct)))).decode("utf-8")
