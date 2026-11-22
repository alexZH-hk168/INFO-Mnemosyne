-- Mnemosyne SQLite schema（唯一定义见 docs/contract/data-model.md，契约 v0.3）
-- 19 张表 + 契约补充的 message_events、memory_blocklist；
-- 附表 chunks_fts（FTS5）在此创建，chunks_vec（sqlite-vec）维度取决于嵌入模型，由 app/db/conn.py 创建。
-- 时间为 ISO 8601 UTC 字符串；*_json 为 JSON 文本。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- 对话 ----------
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT '',
  root_message_id  TEXT,
  active_leaf_id   TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id        TEXT,
  branch_id        TEXT,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'merge_note')),
  content          TEXT NOT NULL DEFAULT '',
  model            TEXT,
  usage_json       TEXT,
  created_at       TEXT NOT NULL,
  client_msg_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_msg_id ON messages(client_msg_id) WHERE client_msg_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS branches (
  id                      TEXT PRIMARY KEY,
  conversation_id         TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  fork_message_id         TEXT NOT NULL,
  anchor_start            INTEGER NOT NULL,
  anchor_end              INTEGER NOT NULL,
  anchor_quote            TEXT NOT NULL DEFAULT '',
  title                   TEXT NOT NULL DEFAULT '',
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'archived')),
  merged_into_message_id  TEXT,
  created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branches_conversation ON branches(conversation_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  step_index   INTEGER NOT NULL,
  tool_name    TEXT NOT NULL,
  args_json    TEXT,
  result_json  TEXT,
  status       TEXT,
  duration_ms  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON tool_calls(message_id, step_index);

CREATE TABLE IF NOT EXISTS citations (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  evidence_id     TEXT NOT NULL,
  label           TEXT NOT NULL,
  sentence_start  INTEGER NOT NULL,
  sentence_end    INTEGER NOT NULL,
  verdict         TEXT NOT NULL CHECK (verdict IN ('supported', 'partial', 'removed')),
  overlap         REAL
);
CREATE INDEX IF NOT EXISTS idx_citations_message ON citations(message_id);
CREATE INDEX IF NOT EXISTS idx_citations_evidence ON citations(evidence_id);

-- 契约补充：SSE 续流事件缓冲
CREATE TABLE IF NOT EXISTS message_events (
  message_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  event       TEXT NOT NULL,
  data_json   TEXT NOT NULL,
  PRIMARY KEY (message_id, seq)
);

-- ---------- 材料与证据 ----------
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('pdf', 'pptx', 'code', 'ipynb', 'md', 'web')),
  "group"       TEXT NOT NULL CHECK ("group" IN ('paper', 'slides', 'code', 'notes', 'web')),
  title         TEXT NOT NULL,
  path          TEXT,
  sha256        TEXT,
  pages         INTEGER,
  cells         INTEGER,
  snapshot_id   TEXT,
  parse_status  TEXT NOT NULL DEFAULT 'queued' CHECK (parse_status IN ('queued', 'parsing', 'ready', 'failed')),
  parse_error   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, created_at);

CREATE TABLE IF NOT EXISTS segments (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('sentence', 'line', 'cell', 'shape')),
  text          TEXT NOT NULL,
  locator_json  TEXT NOT NULL,
  order_idx     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_document ON segments(document_id, order_idx);

CREATE TABLE IF NOT EXISTS chunks (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  text              TEXT NOT NULL,
  segment_ids_json  TEXT NOT NULL,
  token_count       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);

-- BM25 全文索引。body 是预分词文本（拉丁词小写、中日文按二元组），见 app/ingest/tokenize.py
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  body,
  chunk_id UNINDEXED,
  project_id UNINDEXED,
  document_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS evidence (
  id                      TEXT PRIMARY KEY,
  source_type             TEXT NOT NULL CHECK (source_type IN ('material', 'web', 'message', 'plugin')),
  source_id               TEXT NOT NULL,
  locator_json            TEXT NOT NULL,
  quote                   TEXT NOT NULL,
  sha256                  TEXT,
  created_at              TEXT NOT NULL,
  captured_in_message_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence(source_type, source_id);

CREATE TABLE IF NOT EXISTS web_snapshots (
  id           TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  fetched_at   TEXT NOT NULL,
  text         TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  http_status  INTEGER
);

-- ---------- 记忆 ----------
CREATE TABLE IF NOT EXISTS memory_items (
  id                       TEXT PRIMARY KEY,
  scope                    TEXT NOT NULL CHECK (scope IN ('global', 'project', 'branch')),
  scope_id                 TEXT,
  topic                    TEXT NOT NULL DEFAULT '',
  content                  TEXT NOT NULL,
  source_message_ids_json  TEXT NOT NULL DEFAULT '[]',
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'deleted')),
  superseded_by            TEXT,
  valid_from               TEXT,
  valid_to                 TEXT,
  confidence               REAL,
  created_at               TEXT NOT NULL,
  source_conversation_id   TEXT
);

CREATE TABLE IF NOT EXISTS memory_topics (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  scope_id    TEXT,
  name        TEXT NOT NULL,
  md_path     TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_summaries (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  scope_id    TEXT,
  content     TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_digests (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  branch_id        TEXT,
  upto_message_id  TEXT,
  content          TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- 契约补充：用户删除的记忆，抽取时跳过
CREATE TABLE IF NOT EXISTS memory_blocklist (
  id            TEXT PRIMARY KEY,
  content_hash  TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);

-- ---------- 插件与任务 ----------
CREATE TABLE IF NOT EXISTS plugins (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  version        TEXT,
  manifest_json  TEXT NOT NULL,
  config_json    TEXT,
  status         TEXT NOT NULL CHECK (status IN ('installed', 'error', 'disabled')),
  last_check_at  TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  dir_path     TEXT NOT NULL,
  source_url   TEXT,
  license      TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS conversation_plugins (
  conversation_id  TEXT NOT NULL,
  plugin_id        TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (conversation_id, plugin_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('parse_document', 'index_web', 'extract_memory', 'rewrite_digest', 'rewrite_profile')),
  payload_json  TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
