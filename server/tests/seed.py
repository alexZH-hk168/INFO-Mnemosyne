"""把契约 fixtures 的“深度学习导论”场景写进数据库，供契约比对测试使用（ID 与 fixtures 一致）。"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from tests.conftest import ATTENTION_PDF, load_fixture, make_pptx, make_text_pdf


def _ins(conn, table: str, row: dict) -> None:
    cols = ", ".join(f'"{k}"' for k in row)
    qs = ", ".join("?" for _ in row)
    conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({qs})", list(row.values()))


def _msg(conn, m: dict) -> None:
    _ins(
        conn,
        "messages",
        {
            "id": m["id"],
            "conversation_id": m["conversation_id"],
            "parent_id": m.get("parent_id"),
            "branch_id": m.get("branch_id"),
            "role": m["role"],
            "content": m["content"],
            "model": m.get("model"),
            "usage_json": json.dumps(m["usage"]) if m.get("usage") else None,
            "created_at": m["created_at"],
        },
    )
    for idx, s in enumerate(m.get("steps") or []):
        _ins(
            conn,
            "tool_calls",
            {
                "id": s["step_id"],
                "message_id": m["id"],
                "step_index": idx,
                "tool_name": s["kind"],
                "label": s["label"],
                "args_json": "{}",
                "result_json": "{}",
                "status": s["status"],
                "duration_ms": s.get("duration_ms"),
            },
        )
    for c in m.get("citations") or []:
        _ins(
            conn,
            "citations",
            {
                "id": c["citation_id"],
                "message_id": m["id"],
                "evidence_id": c["eid"],
                "label": c["label"],
                "sentence_start": c["sentence_start"],
                "sentence_end": c["sentence_end"],
                "verdict": c["verdict"],
                "overlap": 0.3,
            },
        )


def _write(files_dir: Path, did: str, name: str, data: bytes) -> str:
    d = files_dir / did
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_bytes(data)
    return str(p)


def seed_world(conn, files_dir: Path) -> None:
    for p in load_fixture("get-projects.ok")["body"]["projects"]:
        _ins(conn, "projects", {"id": p["id"], "name": p["name"], "created_at": p["created_at"]})

    tree = load_fixture("get-conversations-cid-tree.ok")["body"]
    conv = tree["conversation"]
    _ins(conn, "conversations", dict(conv))
    summaries = load_fixture("get-projects-pid-conversations.ok")["body"]["conversations"]
    for s in summaries:
        if s["id"] == conv["id"]:
            continue
        _ins(conn, "conversations", {"id": s["id"], "project_id": "prj_dlintro", "title": s["title"], "created_at": s["updated_at"], "updated_at": s["updated_at"]})
    for i in range(2):  # 让 limit=3 时还有下一页
        _ins(conn, "conversations", {"id": f"cnv_old_{i}", "project_id": "prj_dlintro", "title": f"旧对话 {i}", "created_at": "2026-10-01T00:00:00Z", "updated_at": f"2026-10-0{i + 1}T00:00:00Z"})

    for m in tree["messages"]:
        _msg(conn, m)
    # 重新生成的兄弟回答（put-conversations-cid-active_leaf.ok.json 切换到它）
    _msg(conn, {"id": "msg_tf_a1b", "conversation_id": conv["id"], "parent_id": "msg_tf_u1", "role": "assistant", "content": "重新生成的回答。", "model": "chat-model", "created_at": "2026-11-22T06:45:00Z"})
    for b in tree["branches"]:
        row = {k: v for k, v in b.items() if k != "context_turns"}
        _ins(conn, "branches", row)

    # 历史对话“反向传播 · 作业 3”
    ctx = load_fixture("get-evidence-eid.message.ok")["body"]["context_messages"]
    hw3 = "cnv_backprop_hw3"
    _msg(conn, {"id": "msg_hw3_u1", "conversation_id": hw3, "role": "user", "content": "作业 3 第 1 题怎么做？", "created_at": "2026-11-21T12:50:00Z"})
    _msg(conn, {"id": "msg_hw3_a1", "conversation_id": hw3, "parent_id": "msg_hw3_u1", "role": "assistant", "content": "先写出链式法则。", "created_at": "2026-11-21T12:51:00Z"})
    for m in ctx:
        _msg(conn, m)
    conn.execute("UPDATE conversations SET root_message_id = 'msg_hw3_u1', active_leaf_id = 'msg_hw3_u3' WHERE id = ?", (hw3,))

    # 材料
    raw_code = load_fixture("get-documents-did-raw.ok")["body"]
    groups = load_fixture("get-projects-pid-documents.ok")["body"]["groups"]
    for g in groups:
        for d in g["documents"]:
            did, kind = d["id"], d["kind"]
            path = None
            if kind == "pdf":
                if did == "doc_attention" and ATTENTION_PDF.exists():
                    path = str(files_dir / did / "1706.03762v7.pdf")
                    (files_dir / did).mkdir(parents=True, exist_ok=True)
                    shutil.copy(ATTENTION_PDF, path)
                else:
                    path = _write(files_dir, did, d["title"] if d["title"].endswith(".pdf") else "paper.pdf", make_text_pdf(["A seeded paper about memory benchmarks for chat assistants."] * 5, landscape=d["group"] == "slides"))
            elif kind == "pptx":
                path = _write(files_dir, did, d["title"], make_pptx([["注意力", "softmax 饱和"]]))
                (files_dir / did / "preview.pdf").write_bytes(make_text_pdf(["softmax"]))
            elif kind == "code":
                path = _write(files_dir, did, d["title"], raw_code.encode("utf-8"))
            elif kind == "md":
                path = _write(files_dir, did, d["title"], "# 注意力笔记\n\n缩放点积。\n".encode("utf-8"))
            elif kind == "ipynb":
                nb = {"cells": [{"cell_type": "code", "source": ["print(1)\n"], "outputs": []}], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}
                path = _write(files_dir, did, d["title"], json.dumps(nb).encode("utf-8"))
            _ins(
                conn,
                "documents",
                {
                    "id": did,
                    "project_id": d["project_id"],
                    "kind": kind,
                    "group": d["group"],
                    "title": d["title"],
                    "path": path,
                    "sha256": None,
                    "pages": d.get("pages"),
                    "cells": d.get("cells"),
                    "snapshot_id": d.get("snapshot_id"),
                    "parse_status": d["parse_status"],
                    "parse_error": d.get("parse_error"),
                    "created_at": d["created_at"],
                },
            )
            if d["parse_status"] == "parsing":
                _ins(conn, "jobs", {"id": "job_parse_longmem", "kind": "parse_document", "payload_json": json.dumps({"document_id": did, "progress": d["progress"]}), "status": "running", "attempts": 1, "created_at": d["created_at"]})

    # 网页快照与证据
    snap = load_fixture("get-web_snapshots-sid.ok")["body"]
    _ins(conn, "web_snapshots", dict(snap))
    _ins(conn, "web_snapshots", {**snap, "id": "ws_pytorch_sdpa", "url": "https://pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html", "title": "PyTorch"})
    _ins(conn, "web_snapshots", {**snap, "id": "ws_sibling_branch", "url": "https://example.org/sibling", "title": "兄弟分支里抓的网页"})
    captured = {"evd_jalammar_scale": "msg_tf_a1"}
    for name in ("get-evidence-eid.ok", "get-evidence-eid.pptx.ok", "get-evidence-eid.web.ok", "get-evidence-eid.message.ok"):
        e = load_fixture(name)["body"]
        _ins(
            conn,
            "evidence",
            {
                "id": e["id"],
                "source_type": e["source_type"],
                "source_id": e["source_id"],
                "locator_json": json.dumps(e["locator"], ensure_ascii=False),
                "quote": e["quote"],
                "sha256": e.get("sha256"),
                "created_at": "2026-11-22T06:20:05Z",
                "captured_in_message_id": captured.get(e["id"]),
            },
        )
    _ins(conn, "evidence", {"id": "evd_att_p5_heads", "source_type": "material", "source_id": "doc_attention", "locator_json": json.dumps({"page": 5, "sentence_ids": ["s5_1"], "bbox": [108.0, 80.0, 504.0, 100.0]}), "quote": "Multi-head attention allows the model to jointly attend.", "sha256": None, "created_at": "2026-11-22T06:38:03Z", "captured_in_message_id": None})
    _ins(conn, "evidence", {"id": "evd_sibling_branch", "source_type": "web", "source_id": "ws_sibling_branch", "locator_json": json.dumps({"snapshot_id": "ws_sibling_branch", "char_range": [0, 24]}), "quote": "Self-Attention in Detail", "sha256": None, "created_at": "2026-11-22T06:25:12Z", "captured_in_message_id": "msg_bv_a1"})
    _ins(conn, "evidence", {"id": "evd_pytorch", "source_type": "web", "source_id": "ws_pytorch_sdpa", "locator_json": json.dumps({"snapshot_id": "ws_pytorch_sdpa", "char_range": [0, 24]}), "quote": "Self-Attention in Detail", "sha256": None, "created_at": "2026-11-22T06:38:04Z", "captured_in_message_id": "msg_tf_a2"})
    conn.commit()
