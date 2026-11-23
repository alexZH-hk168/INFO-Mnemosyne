"""接口模型：字段与 docs/contract/rest-api.md、types.ts（v0.3）一一对应，extra=forbid 防止多发字段。
带 `?` 的契约字段在这里是 `X | None = None`，序列化时省略（exclude_none）。
"""

from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel, ConfigDict


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------- 错误 ----------
class ApiErrorDetail(Strict):
    code: Literal[
        "VALIDATION_ERROR", "NOT_FOUND", "NOT_VISIBLE_ON_PATH", "PARSE_FAILED", "MODEL_UNAVAILABLE",
        "PLUGIN_SELF_CHECK_FAILED", "PLUGIN_TIMEOUT", "SKILL_INVALID", "INTERNAL",
    ]
    message: str
    retriable: bool
    details: dict | None = None


class ApiErrorBody(Strict):
    error: ApiErrorDetail


# ---------- 项目与对话 ----------
class Project(Strict):
    id: str
    name: str
    created_at: str
    conversation_count: int


class ProjectList(Strict):
    projects: list[Project]


class CreateProjectBody(BaseModel):
    name: str


class ConversationSummary(Strict):
    id: str
    title: str
    updated_at: str
    branch_count: int


class ConversationList(Strict):
    conversations: list[ConversationSummary]
    next_cursor: str | None = None


class CreateConversationBody(BaseModel):
    title: str | None = None


class Conversation(Strict):
    id: str
    project_id: str
    title: str
    root_message_id: str | None = None
    active_leaf_id: str | None = None
    created_at: str
    updated_at: str


class Usage(Strict):
    prompt_tokens: int
    completion_tokens: int


class Step(Strict):
    step_id: str
    kind: Literal["search_materials", "search_web", "fetch_url", "recall_memory", "open_source", "plugin_tool", "load_skill"]
    label: str
    status: Literal["running", "done", "error"]
    duration_ms: int | None = None
    plugin_id: str | None = None  # v0.5 [F6b]（原 U60）：kind=plugin_tool 时发起调用的插件 id


class Citation(Strict):
    citation_id: str
    eid: str
    label: str
    sentence_start: int
    sentence_end: int
    verdict: Literal["supported", "partial", "removed"]


class Message(Strict):
    id: str
    conversation_id: str
    parent_id: str | None = None
    branch_id: str | None = None
    role: Literal["user", "assistant", "tool", "merge_note"]
    content: str
    model: str | None = None
    usage: Usage | None = None
    created_at: str
    steps: list[Step] | None = None
    citations: list[Citation] | None = None


class Branch(Strict):
    id: str
    conversation_id: str
    fork_message_id: str
    anchor_start: int
    anchor_end: int
    anchor_quote: str
    title: str
    status: Literal["open", "merged", "archived"]
    merged_into_message_id: str | None = None
    created_at: str
    context_turns: int


class ConversationTree(Strict):
    conversation: Conversation
    messages: list[Message]
    branches: list[Branch]
    active_leaf_id: str | None = None


class ActiveLeafBody(BaseModel):
    message_id: str


class ActiveLeaf(Strict):
    active_leaf_id: str


# ---------- 材料与证据 ----------
DocKind = Literal["pdf", "pptx", "code", "ipynb", "md", "web"]
DocGroup = Literal["paper", "slides", "code", "notes", "web"]


class Document(Strict):
    id: str
    project_id: str
    kind: DocKind
    group: DocGroup
    title: str
    pages: int | None = None
    lines: int | None = None
    cells: int | None = None
    snapshot_id: str | None = None
    parse_status: Literal["queued", "parsing", "ready", "failed"]
    progress: int
    parse_error: str | None = None
    cited_count: int
    created_at: str


class DocumentGroup(Strict):
    group: DocGroup
    documents: list[Document]


class DocumentGroups(Strict):
    groups: list[DocumentGroup]


class UploadResult(Strict):
    documents: list[Document]
    job_ids: list[str]


class JobResult(Strict):
    job_id: str


class PdfLocator(Strict):
    page: int
    sentence_ids: list[str]
    bbox: tuple[float, float, float, float]


class PptxLocator(Strict):
    slide: int
    shape_id: int
    char_range: tuple[int, int]


class LinesLocator(Strict):
    path: str
    lines: tuple[int, int]
    cell: int | None = None


class WebLocator(Strict):
    snapshot_id: str
    char_range: tuple[int, int]


class MessageLocator(Strict):
    message_id: str
    char_range: tuple[int, int]


class PluginLocator(Strict):
    plugin_id: str
    tool_name: str
    fields: dict


Locator = Union[PdfLocator, PptxLocator, LinesLocator, WebLocator, MessageLocator, PluginLocator]


class CitedBy(Strict):
    message_id: str
    label: str


class Evidence(Strict):
    id: str
    label: str | None = None
    source_type: Literal["material", "web", "message", "plugin"]
    source_id: str
    title: str
    locator: Locator
    quote: str
    sha256: str | None = None
    cited_by: list[CitedBy] | None = None
    context_messages: list[Message] | None = None


class WebSnapshot(Strict):
    id: str
    url: str
    title: str
    fetched_at: str
    text: str
    sha256: str
    http_status: int



# ---------- 分支（B3a） ----------
class BranchAnchor(BaseModel):
    start: int
    end: int
    quote: str


class CreateBranchBody(BaseModel):
    conversation_id: str
    fork_message_id: str
    anchor: BranchAnchor


class UpdateBranchBody(BaseModel):
    status: str | None = None
    title: str | None = None


class MergeResult(Strict):
    branch: Branch
    merge_note: Message


# ---------- 记忆（B3a） ----------
class MemoryItem(Strict):
    id: str
    scope: Literal["global", "project", "branch"]
    scope_id: str | None = None
    topic: str
    content: str
    source_message_ids: list[str]
    status: Literal["active", "superseded", "deleted"]
    valid_from: str | None = None
    valid_to: str | None = None
    confidence: float
    source_conversation_id: str | None = None


class MemoryItemList(Strict):
    items: list[MemoryItem]


class UpdateMemoryItemBody(BaseModel):
    content: str


class MemorySummary(Strict):
    content: str
    version: int
    updated_at: str


class OkResult(Strict):
    ok: bool


def dump(model: BaseModel) -> dict:
    return model.model_dump(mode="json", exclude_none=True)
