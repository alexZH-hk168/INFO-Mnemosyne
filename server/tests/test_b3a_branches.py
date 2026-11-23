"""B3a：分支接口与分支可见性 5 条规则。三组必测用例（DEVELOPMENT.md §3）：
A 合并前兄弟分支互不可见；B 合并后条目对主线可见；C 按 ID 访问路径外消息返回 NOT_VISIBLE_ON_PATH。
场景用契约 fixtures 的“深度学习导论”世界：cnv_transformer 在 msg_tf_a1 上开了两个兄弟分支 br_variance、br_onehot。
"""

from __future__ import annotations

import pytest

from app.branch import path as P
from app.errors import ApiError
from app.memory import store
from app.memory.service import memory
from tests.seed import seed_world

CID = "cnv_transformer"
PID = "prj_dlintro"


@pytest.fixture
def world(client, db, env):
    from app.config import get_config

    seed_world(db, get_config().files_dir)
    # 两个兄弟分支各有一条分支作用域的记忆，来源是各自分支里的消息
    store.insert_item(db, scope="branch", scope_id="br_variance", topic="注意力缩放", content="已理解点积方差等于 dₖ 的推导",
                      source_message_ids=["msg_bv_u1"], valid_from="2026-11-22T06:25:00Z", confidence=0.8, source_conversation_id=CID)
    store.insert_item(db, scope="branch", scope_id="br_onehot", topic="softmax", content="已理解 softmax 输出接近 one-hot 的含义",
                      source_message_ids=["msg_bo_u1"], valid_from="2026-11-22T06:31:00Z", confidence=0.8, source_conversation_id=CID)
    db.commit()
    return db


def recall_contents(db, leaf, query="方差 推导 softmax one-hot 理解"):
    drafts = memory.recall(db, project_id=PID, conversation_id=CID, leaf_message_id=leaf, query=query)
    return " ".join(d.title for d in drafts), drafts


# ---------- A：合并前兄弟分支互不可见 ----------

def test_A_siblings_invisible_before_merge(world, client):
    db = world
    in_variance = P.visible_message_ids(db, CID, "msg_bv_a2")
    in_onehot = P.visible_message_ids(db, CID, "msg_bo_a1")
    assert {"msg_tf_u1", "msg_tf_a1", "msg_bv_u1", "msg_bv_a2"} <= in_variance
    assert not ({"msg_bo_u1", "msg_bo_a1"} & in_variance)
    assert not ({"msg_bv_u1", "msg_bv_a1"} & in_onehot)
    # 锚点之后的主线（m3、m4）在分支里也看不到
    assert "msg_tf_u2" not in in_variance
    assert P.visible_branch_ids(db, CID, "msg_bv_a2") == {"br_variance"}

    # 规则 1：记忆召回
    text, _ = recall_contents(db, "msg_bv_a2")
    assert "方差" in text and "one-hot" not in text
    text, _ = recall_contents(db, "msg_bo_a1")
    assert "one-hot" in text and "方差" not in text
    text, _ = recall_contents(db, None)  # 主线（active_leaf）：两个未合并分支的条目都看不到
    assert "方差" not in text and "one-hot" not in text

    # 规则 4：兄弟分支里抓的网页证据（captured_in_message_id=msg_bv_a1）
    assert client.get("/api/evidence/evd_sibling_branch", params={"leaf_id": "msg_bv_a2"}).status_code == 200
    r = client.get("/api/evidence/evd_sibling_branch", params={"leaf_id": "msg_bo_a1"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_VISIBLE_ON_PATH"


# ---------- B：合并后条目对主线可见 ----------

def test_B_merge_makes_branch_visible_to_mainline(world, client):
    db = world
    main_leaf_before = db.execute("SELECT active_leaf_id FROM conversations WHERE id = ?", (CID,)).fetchone()[0]
    r = client.post("/api/branches/br_variance/merge")
    assert r.status_code == 200, r.text
    body = r.json()
    note = body["merge_note"]
    assert body["branch"]["status"] == "merged" and body["branch"]["merged_into_message_id"] == note["id"]
    assert note["role"] == "merge_note" and note["parent_id"] == main_leaf_before and "branch_id" not in note
    assert note["content"].startswith("分支「方差为什么是 dₖ」要点：")
    assert db.execute("SELECT active_leaf_id FROM conversations WHERE id = ?", (CID,)).fetchone()[0] == note["id"]

    # 分支消息对主线可见；兄弟分支仍不可见
    main = P.visible_message_ids(db, CID)
    assert {"msg_bv_u1", "msg_bv_a2", note["id"]} <= main
    assert "msg_bo_a1" not in main
    # 规则 5：分支条目升 project；规则 1：主线能召回它
    row = db.execute("SELECT scope, scope_id FROM memory_items WHERE content LIKE '已理解点积方差%'").fetchone()
    assert (row["scope"], row["scope_id"]) == ("project", PID)
    text, drafts = recall_contents(db, None)
    assert "方差" in text and "one-hot" not in text
    d = next(d for d in drafts if "方差" in d.title)
    assert d.kind == "message" and d.source_id == "msg_bv_u1" and d.locator["message_id"] == "msg_bv_u1"
    # 合并后的 open_source、证据都能在主线打开
    assert P.check_open_source(db, "msg_bv_a1", conversation_id=CID)["id"] == "msg_bv_a1"
    assert client.get("/api/evidence/evd_sibling_branch").status_code == 200
    # 主题 md 从分支作用域搬到项目作用域
    assert store.topic_md_path("project", PID, "注意力缩放").exists()
    assert not store.topic_md_path("branch", "br_variance", "注意力缩放").exists()
    # 树接口里有合并卡片；对话列表 branch_count 仍为 2（merged 也算，archived 不算）
    tree = client.get(f"/api/conversations/{CID}/tree").json()
    assert any(x["id"] == note["id"] and x["role"] == "merge_note" for x in tree["messages"])
    # 再合并一次 → 400
    r2 = client.post("/api/branches/br_variance/merge")
    assert r2.status_code == 400 and r2.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------- C：按 ID 访问路径外消息 → NOT_VISIBLE_ON_PATH ----------

def test_C_open_source_outside_path_rejected(world):
    db = world
    with pytest.raises(ApiError) as e:
        P.check_open_source(db, "msg_bo_a1", conversation_id=CID)  # 主线看兄弟分支
    assert e.value.code == "NOT_VISIBLE_ON_PATH"
    with pytest.raises(ApiError) as e:
        P.check_open_source(db, "msg_bv_a1", conversation_id=CID, leaf_id="msg_bo_a1")  # 分支看兄弟分支
    assert e.value.code == "NOT_VISIBLE_ON_PATH"
    with pytest.raises(ApiError) as e:
        P.check_open_source(db, "msg_tf_u2", conversation_id=CID, leaf_id="msg_bv_a2")  # 分支看锚点之后的主线
    assert e.value.code == "NOT_VISIBLE_ON_PATH"
    with pytest.raises(ApiError) as e:
        P.check_open_source(db, "msg_nope", conversation_id=CID)
    assert e.value.code == "NOT_FOUND"
    # 路径上的消息、其他对话按自己的当前路径（历史对话）都能打开
    assert P.check_open_source(db, "msg_bv_a1", conversation_id=CID, leaf_id="msg_bv_a2")
    assert P.check_open_source(db, "msg_tf_a1", conversation_id=CID, leaf_id="msg_bo_a1")
    assert P.check_open_source(db, "msg_hw3_u1", conversation_id=CID, leaf_id="msg_bv_a2")


# ---------- 规则 2：L4 只汇总 global 与 project ----------

def test_rule2_l4_excludes_branch_items(world):
    db = world
    store.insert_item(db, scope="global", scope_id=None, topic="回答偏好", content="希望先给一句话结论",
                      source_message_ids=["msg_tf_u1"], valid_from="2026-11-22T06:20:00Z", confidence=0.7, source_conversation_id=CID)
    store.insert_item(db, scope="project", scope_id=PID, topic="反向传播", content="作业 3 卡在 sigmoid 饱和",
                      source_message_ids=["msg_hw3_u1"], valid_from="2026-11-21T13:05:00Z", confidence=0.8, source_conversation_id="cnv_backprop_hw3")
    store.insert_item(db, scope="project", scope_id="prj_other", topic="别的项目", content="别的项目里的条目",
                      source_message_ids=["msg_hw3_u1"], valid_from="2026-11-21T13:05:00Z", confidence=0.8, source_conversation_id="cnv_backprop_hw3")
    contents = {r["content"] for r in P.l4_items(db, PID)}
    assert contents == {"希望先给一句话结论", "作业 3 卡在 sigmoid 饱和"}
    from app.memory.pipeline import run_profile

    run_profile(db, {"project_id": PID})
    profile = memory.l4_profile(db, PID)
    assert "希望先给一句话结论" in profile and "sigmoid" in profile
    assert "方差" not in profile and "one-hot" not in profile and "别的项目" not in profile


# ---------- 分支接口 ----------

def test_create_branch_title_and_validation(world, client):
    a1 = world.execute("SELECT content FROM messages WHERE id = 'msg_tf_a1'").fetchone()[0]
    from app.memory.pipeline import plain

    text = plain(a1)
    i = text.index("softmax")
    quote = text[i : i + 20]
    r = client.post("/api/branches", json={"conversation_id": CID, "fork_message_id": "msg_tf_a1", "anchor": {"start": i, "end": i + 20, "quote": quote}})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["id"].startswith("br_") and b["status"] == "open" and b["anchor_quote"] == quote
    assert b["title"] == quote.strip()[:12]  # U48
    assert b["context_turns"] == 1 and "merged_into_message_id" not in b
    tree = client.get(f"/api/conversations/{CID}/tree").json()
    assert any(x["id"] == b["id"] for x in tree["branches"])

    def bad(body, code=400):
        r = client.post("/api/branches", json=body)
        assert r.status_code == code, r.text
        return r.json()["error"]["code"]

    base = {"conversation_id": CID, "fork_message_id": "msg_tf_a1"}
    assert bad({**base, "anchor": {"start": 900, "end": 920, "quote": "x"}}) == "VALIDATION_ERROR"
    assert bad({**base, "anchor": {"start": 5, "end": 5, "quote": ""}}) == "VALIDATION_ERROR"
    assert bad({**base, "anchor": {"start": i, "end": i + 7, "quote": "不一致的片段"}}) == "VALIDATION_ERROR"
    assert bad({**base, "fork_message_id": "msg_tf_u1", "anchor": {"start": 0, "end": 2, "quote": "结合"}}) == "VALIDATION_ERROR"
    assert bad({"conversation_id": "cnv_missing", "fork_message_id": "msg_tf_a1", "anchor": {"start": 0, "end": 2, "quote": "一句"}}, 404) == "NOT_FOUND"
    assert bad({**base, "fork_message_id": "msg_missing", "anchor": {"start": 0, "end": 2, "quote": "一句"}}, 404) == "NOT_FOUND"
    assert bad({"conversation_id": CID}) == "VALIDATION_ERROR"


def test_update_branch_rename_archive(world, client):
    r = client.put("/api/branches/br_onehot", json={"title": "  独热输出  "})
    assert r.status_code == 200 and r.json()["title"] == "独热输出"
    assert client.put("/api/branches/br_onehot", json={"title": "  "}).status_code == 400
    assert client.put("/api/branches/br_onehot", json={"status": "open"}).status_code == 400
    assert client.put("/api/branches/br_missing", json={"title": "x"}).status_code == 404
    r = client.put("/api/branches/br_onehot", json={"status": "archived"})
    assert r.status_code == 200 and r.json()["status"] == "archived"
    # U47：branch_count 不计归档分支
    convs = client.get(f"/api/projects/{PID}/conversations").json()["conversations"]
    assert next(c for c in convs if c["id"] == CID)["branch_count"] == 1
    # 归档分支不能合并；已合并分支不能归档
    assert client.post("/api/branches/br_onehot/merge").status_code == 400
    assert client.post("/api/branches/br_variance/merge").status_code == 200
    r = client.put("/api/branches/br_variance", json={"status": "archived"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_merge_requires_an_answer(world, client):
    from app.memory.pipeline import plain

    text = plain(world.execute("SELECT content FROM messages WHERE id = 'msg_tf_a1'").fetchone()[0])
    b = client.post("/api/branches", json={"conversation_id": CID, "fork_message_id": "msg_tf_a1", "anchor": {"start": 0, "end": 3, "quote": text[:3]}}).json()
    r = client.post(f"/api/branches/{b['id']}/merge")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    r = client.post("/api/branches/br_missing/merge")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
