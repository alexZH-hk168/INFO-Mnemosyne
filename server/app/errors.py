"""统一错误体：{ "error": { code, message, retriable, details? } }（契约 rest-api.md“错误码”）。"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("mnemosyne.api")

STATUS = {
    "VALIDATION_ERROR": 400,
    "NOT_FOUND": 404,
    "NOT_VISIBLE_ON_PATH": 403,
    "PARSE_FAILED": 422,
    "MODEL_UNAVAILABLE": 502,
    "PLUGIN_SELF_CHECK_FAILED": 502,
    "PLUGIN_TIMEOUT": 504,
    "SKILL_INVALID": 422,
    "INTERNAL": 500,
}
RETRIABLE = {
    "VALIDATION_ERROR": False,
    "NOT_FOUND": False,
    "NOT_VISIBLE_ON_PATH": False,
    "PARSE_FAILED": True,
    "MODEL_UNAVAILABLE": True,
    "PLUGIN_SELF_CHECK_FAILED": True,
    "PLUGIN_TIMEOUT": True,
    "SKILL_INVALID": False,
    "INTERNAL": True,
}


class ApiError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def error_body(code: str, message: str, details: dict | None = None) -> dict:
    err = {"code": code, "message": message, "retriable": RETRIABLE[code]}
    if details:
        err["details"] = details
    return {"error": err}


def error_response(code: str, message: str, details: dict | None = None) -> JSONResponse:
    return JSONResponse(status_code=STATUS[code], content=error_body(code, message, details))


def not_found(what: str) -> ApiError:
    return ApiError("NOT_FOUND", f"{what}不存在")


def _validation_message(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(x) for x in err.get("loc", []) if x not in ("body", "query", "path"))
        parts.append(f"{loc or '请求'}：{err.get('msg', '不合法')}")
    return "请求字段不合法（" + "；".join(parts) + "）" if parts else "请求字段不合法"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return error_response(exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        return error_response("VALIDATION_ERROR", _validation_message(exc))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        if exc.status_code == 404:
            return error_response("NOT_FOUND", "接口不存在")
        if exc.status_code == 405:
            return error_response("VALIDATION_ERROR", "不支持的请求方法")
        return error_response("INTERNAL", str(exc.detail))

    @app.exception_handler(Exception)
    async def _internal(_: Request, exc: Exception):
        log.exception("unhandled error", exc_info=exc)
        return error_response("INTERNAL", "服务器内部错误，请稍后重试")
