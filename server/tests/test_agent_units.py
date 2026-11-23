"""B2 单元测试：切句与偏移、引用校验三关、假模型、OpenAI 兼容适配层（MockTransport，不联网）。"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.agent.citations import PoolItem, collect, parse_verdicts, unverified, verify
from app.agent.text import cross_language, overlap, sentence_for_position, split_sentences, strip_markers
from app.llm.base import ModelError
from app.llm.fake import FakeModel, build_answer, chunk_text, fake_verdict
from app.llm.openai_compat import OpenAICompatModel

from .conftest import load_fixture

QUOTE = (
    "To illustrate why the dot products get large, assume that the components of q and k are independent "
    "random variables with mean 0 and variance 1."
)


def run(coro):
    return asyncio.run(coro)


# ---------- 切句与偏移 ----------

@pytest.mark.parametrize("name", ["sse-turn-full", "sse-turn-cancel", "post-messages-mid-regenerate.ok"])
def test_sentence_spans_match_contract_fixtures(name):
    fx = load_fixture(name)
    raw = "".join(e["data"]["text"] for e in fx["events"] if e["event"] == "delta")
    plain, marks = strip_markers(raw)
    spans = split_sentences(plain)
    want = [(e["data"]["label"], e["data"]["sentence_start"], e["data"]["sentence_end"]) for e in fx["events"] if e["event"] == "citation"]
    got = [(lab, *sentence_for_position(spans, pos)) for lab, pos in marks]
    assert got == want


def test_offsets_are_code_points():
    raw = "𝑑 很大时方差变大[[E1]]。下一句。"
    plain, marks = strip_markers(raw)
    assert plain == "𝑑 很大时方差变大。下一句。"
    assert marks == [("E1", 9)]
    s, e = sentence_for_position(split_sentences(plain), 9)
    assert plain[s:e] == "𝑑 很大时方差变大。"
    assert (s, e) == (0, 10)  # 码点计数：𝑑 算 1 个


def test_marker_after_period_belongs_to_previous_sentence():
    plain, marks = strip_markers("第一句。[[E1]]第二句。")
    span = sentence_for_position(split_sentences(plain), marks[0][1])
    assert plain[span[0]:span[1]] == "第一句。"


def test_english_sentence_split():
    spans = split_sentences("It works. Next one! 第三句？\nLine four")
    assert len(spans) == 4


# ---------- 引用校验三关 ----------

def _pool():
    return {
        "E1": PoolItem("evd_a", "E1", QUOTE),
        "E2": PoolItem("evd_b", "E2", QUOTE),
        "E3": PoolItem("evd_c", "E3", QUOTE),
    }


def test_three_verdicts_supported_partial_removed():
    supported = f"{QUOTE.rstrip('.')}[[E1]]。"
    partial = "To illustrate why the dot products get large，这一点在材料里只有部分依据，需要结合上下文理解[[E2]]。"
    removed = "这部分内容和问题的关系还不清楚[[E3]]。"
    checks, _ = run(verify(supported + partial + removed, _pool(), FakeModel(), "fake-small"))
    assert [(c.label, c.verdict) for c in checks] == [("E1", "supported"), ("E2", "partial"), ("E3", "removed")]
    assert checks[2].overlap is not None and checks[2].overlap < 0.05  # 第二关剔除
    assert checks[0].overlap > 0.9


def test_gate1_unknown_label_removed_with_empty_eid():
    checks = collect("没有这条证据[[E9]]。", _pool())
    assert checks[0].verdict == "removed" and checks[0].eid == ""


def test_gate2_cross_language_goes_to_gate3():
    sent = "论文假设 q 和 k 的各分量独立、均值为 0、方差为 1[[E1]]。"
    assert cross_language("论文假设各分量独立、均值为零、方差为一", QUOTE)
    checks = collect(sent, _pool())
    from app.agent.citations import gate_overlap

    gate_overlap(checks)
    assert checks[0].verdict is None  # 没被第二关剔除，留给小模型


def test_gate3_single_call_and_failure_falls_back_to_partial():
    calls = []

    class Judge:
        async def complete(self, messages, *, model):
            calls.append(messages)
            return "不是 JSON", (1, 1)

    class Broken:
        async def complete(self, messages, *, model):
            raise ModelError("down")

    text = f"{QUOTE.rstrip('.')}[[E1]]。{QUOTE.rstrip('.')}[[E2]]。"
    checks, _ = run(verify(text, _pool(), Judge(), "m"))
    assert len(calls) == 1  # 多条引用合并为一次调用
    assert [c.verdict for c in checks] == ["partial", "partial"]
    checks, _ = run(verify(text, _pool(), Broken(), "m"))
    assert [c.verdict for c in checks] == ["partial", "partial"]


def test_same_label_twice_in_sentence_counts_once():
    checks = collect(f"{QUOTE}[[E1]][[E1]]", _pool())
    assert len(checks) == 1


def test_unverified_marks_partial():
    checks = unverified("一句[[E1]]。另一句[[E7]]。", _pool())
    assert [c.verdict for c in checks] == ["partial", "removed"]


def test_parse_verdicts():
    assert parse_verdicts('结果：[{"i": 0, "verdict": "supported"}, {"i": 1, "verdict": "bad"}]') == {0: "supported"}


def test_overlap_and_fake_verdict():
    assert overlap("abc", "xxabcxx") == 1.0
    assert fake_verdict(QUOTE, QUOTE) == "supported"
    assert fake_verdict("完全无关的句子", QUOTE) == "removed"


# ---------- 假模型 ----------

def test_fake_model_plans_tools_then_answers():
    tools = [{"type": "function", "function": {"name": n}} for n in ("search_materials", "recall_memory", "search_web", "fetch_url")]
    msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "为什么除以根号 dk"}]

    async def collect_chunks(m):
        return [c async for c in FakeModel().stream(m, model="fake-chat", tools=tools)]

    first = run(collect_chunks(msgs))
    calls = [c for ch in first if ch.tool_calls for c in ch.tool_calls]
    assert [c.name for c in calls] == ["search_materials", "recall_memory", "search_web"]
    msgs += [
        {"role": "assistant", "content": None, "tool_calls": [{"id": c.id, "type": "function", "function": {"name": c.name, "arguments": "{}"}} for c in calls]},
        {"role": "tool", "tool_call_id": "call_1", "content": f"[[E1]] 《Paper》\n{QUOTE}\n\n[[E2]] 《Slides》\n{QUOTE}"},
        {"role": "tool", "tool_call_id": "call_2", "content": "没有找到相关的历史对话。"},
        {"role": "tool", "tool_call_id": "call_3", "content": "1. R\nhttps://example.org/a\nsnippet"},
    ]
    second = run(collect_chunks(msgs))
    assert [c.name for ch in second if ch.tool_calls for c in ch.tool_calls] == ["fetch_url"]


def test_build_answer_and_chunks_keep_markers_whole():
    text = build_answer([("E1", "t", QUOTE), ("E2", "t", QUOTE), ("E3", "t", QUOTE)], "q")
    assert "[[E1]]" in text and "[[E2]]" in text and "[[E3]]" in text
    parts = chunk_text(text)
    assert "".join(parts) == text
    assert all(p.count("[[") == p.count("]]") for p in parts)


# ---------- OpenAI 兼容适配层（MockTransport） ----------

def _sse_lines(objs):
    return "".join(f"data: {json.dumps(o)}\n\n" for o in objs) + "data: [DONE]\n\n"


def test_openai_compat_stream_text_tool_calls_usage():
    seen = {}

    def handler(request: httpx.Request):
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        body = _sse_lines([
            {"choices": [{"delta": {"content": "你好"}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "search_", "arguments": '{"que'}}]}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"name": "materials", "arguments": 'ry": "x"}'}}]}}]},
            {"choices": [], "usage": {"prompt_tokens": 11, "completion_tokens": 3}},
        ])
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    model = OpenAICompatModel("https://llm.invalid/v1", "sk-test", transport=httpx.MockTransport(handler))

    async def go():
        return [c async for c in model.stream([{"role": "user", "content": "hi"}], model="m", tools=[{"type": "function"}])]

    chunks = run(go())
    assert seen["auth"] == "Bearer sk-test" and seen["body"]["stream"] is True and seen["body"]["model"] == "m"
    assert [c.text for c in chunks if c.text] == ["你好"]
    assert [c.usage for c in chunks if c.usage] == [(11, 3)]
    calls = [t for c in chunks if c.tool_calls for t in c.tool_calls]
    assert len(calls) == 1 and calls[0].name == "search_materials" and calls[0].arguments == {"query": "x"}


def test_openai_compat_errors_become_model_error():
    model = OpenAICompatModel("https://llm.invalid/v1", "k", transport=httpx.MockTransport(lambda r: httpx.Response(401, text="bad key")))

    async def go():
        return [c async for c in model.stream([], model="m")]

    with pytest.raises(ModelError):
        run(go())
    with pytest.raises(ModelError):
        run(model.complete([], model="m"))


def test_openai_compat_complete():
    def handler(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": "标题"}}], "usage": {"prompt_tokens": 2, "completion_tokens": 1}})

    model = OpenAICompatModel("https://llm.invalid/v1", "k", transport=httpx.MockTransport(handler))
    assert run(model.complete([{"role": "user", "content": "x"}], model="m")) == ("标题", (2, 1))
