// 契约样例的唯一数据源：scripts/gen-fixtures.ts 读取本文件，写出 docs/contract/fixtures/*.json。
// 场景：“深度学习导论”项目，与概念图 UI-05（分支对话）、UI-06（证据预览）一致。
// 偏移量（sentence_start/end、anchor、char_range）全部由函数从正文算出，不手填。
// 只在 Node 端（生成脚本）使用；浏览器端的 MSW 读的是生成后的 JSON。
import { createHash } from 'node:crypto';
import type {
  ApiError,
  Branch,
  Citation,
  Conversation,
  ConversationSummary,
  ConversationTree,
  Document,
  ErrorCode,
  Evidence,
  InstalledPlugin,
  Locator,
  MarketItem,
  MemoryItem,
  Message,
  PluginDetail,
  Project,
  SendMessageBody,
  Settings,
  Skill,
  SkillDetail,
  SourceType,
  SseEvent,
  Step,
  WebSnapshot,
  CreateBranchBody,
} from '../api/types';
import type {
  ActiveLeafResult,
  ConversationPage,
  ConversationPluginList,
  CreateConversationBody,
  CreateProjectBody,
  DocumentGroups,
  ImportSkillBody,
  InstallPluginBody,
  JobResult,
  MarketList,
  MemoryItemList,
  MemorySummary,
  MergeResult,
  OkResult,
  PluginList,
  ProjectList,
  SetActiveLeafBody,
  SetConversationPluginsBody,
  SkillList,
  UpdateBranchBody,
  UpdateMemoryItemBody,
  UpdateSettingsBody,
  UpdateSkillBody,
  UploadResult,
} from '../api/endpoints';
import type { FixtureFile, FixtureRequest, RestFixture, SseFixture } from './fixture-types';
import { MARKET_DATA } from './market-data';

// ---------------------------------------------------------------- 工具函数

/** 去掉 `[[E#]]` 标记后的纯文本（分支锚点与引用句子共用的坐标系） */
export function stripMarkers(text: string): string {
  return text.replace(/\[\[E\d+\]\]/g, '');
}

// 契约 v0.2：偏移一律左闭右开、按 Unicode 码点计数。JS 字符串按 UTF-16 索引，这里全部换算成码点。
const cps = (s: string) => Array.from(s);
const cpLen = (s: string) => cps(s).length;

/** 标记 `[[label]]` 所在句子在纯文本中的 [start, end)（码点）：从上一个句号之后（跳过空白）到本句句号之后 */
function sentenceSpan(raw: string, label: string): [number, number] {
  const marker = `[[${label}]]`;
  const rawIdx = raw.indexOf(marker);
  if (rawIdx < 0) throw new Error(`正文里没有 ${marker}`);
  const plain = cps(stripMarkers(raw));
  const pos = cpLen(stripMarkers(raw.slice(0, rawIdx)));
  let start = plain.lastIndexOf('。', pos - 1) + 1;
  while (/\s/.test(plain[start] ?? '')) start += 1;
  const stop = plain.indexOf('。', pos);
  const end = stop < 0 ? plain.length : stop + 1;
  return [start, end];
}

/** 子串在纯文本中的 [start, end)（码点） */
function rangeOf(text: string, quote: string): [number, number] {
  const plain = stripMarkers(text);
  const utf16Start = plain.indexOf(quote);
  if (utf16Start < 0) throw new Error(`找不到片段：${quote}`);
  const start = cpLen(plain.slice(0, utf16Start));
  return [start, start + cpLen(quote)];
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function apiError(code: ErrorCode, message: string, retriable: boolean, details?: Record<string, unknown>): ApiError {
  return { error: details ? { code, message, retriable, details } : { code, message, retriable } };
}

const HTTP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  NOT_VISIBLE_ON_PATH: 403,
  PARSE_FAILED: 422,
  MODEL_UNAVAILABLE: 502,
  PLUGIN_SELF_CHECK_FAILED: 502,
  PLUGIN_TIMEOUT: 504,
  SKILL_INVALID: 422,
  INTERNAL: 500,
};
const RETRIABLE: Record<ErrorCode, boolean> = {
  VALIDATION_ERROR: false,
  NOT_FOUND: false,
  NOT_VISIBLE_ON_PATH: false,
  PARSE_FAILED: true,
  MODEL_UNAVAILABLE: true,
  PLUGIN_SELF_CHECK_FAILED: true,
  PLUGIN_TIMEOUT: true,
  SKILL_INVALID: false,
  INTERNAL: true,
};

function slug(endpoint: string): string {
  const [method, path] = endpoint.split(' ');
  return `${method.toLowerCase()}-${path
    .replace(/^\/api\//, '')
    .replace(/[{}]/g, '')
    .replace(/\//g, '-')}`;
}

const files: FixtureFile[] = [];

function ok<T>(
  endpoint: string,
  description: string,
  request: FixtureRequest | undefined,
  body: T,
  variant?: string,
  status = 200,
) {
  const content: RestFixture = { endpoint, kind: 'ok', description, status, body };
  if (request) content.request = request;
  files.push({ file: `${slug(endpoint)}${variant ? `.${variant}` : ''}.ok.json`, content });
}

function err(
  endpoint: string,
  description: string,
  request: FixtureRequest | undefined,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  const content: RestFixture = {
    endpoint,
    kind: 'error',
    description,
    status: HTTP[code],
    body: apiError(code, message, RETRIABLE[code], details),
  };
  if (request) content.request = request;
  files.push({ file: `${slug(endpoint)}.error.json`, content });
}

function sse(
  file: string,
  endpoint: string,
  description: string,
  request: FixtureRequest | undefined,
  events: SseEvent[],
  disconnect_after_seq?: number,
) {
  const content: SseFixture = {
    endpoint,
    kind: 'sse',
    description,
    status: 200,
    content_type: 'text/event-stream',
    events,
  };
  if (request) content.request = request;
  if (disconnect_after_seq !== undefined) content.disconnect_after_seq = disconnect_after_seq;
  files.push({ file, content });
}

/** 给事件按顺序编 seq（从 1 开始） */
type EventNoSeq = SseEvent extends infer E
  ? E extends { event: infer N; data: infer D }
    ? { event: N; data: Omit<D, 'seq'> }
    : never
  : never;
function numbered(list: EventNoSeq[]): SseEvent[] {
  return list.map((e, i) => ({ event: e.event, data: { ...e.data, seq: i + 1 } }) as SseEvent);
}

// ---------------------------------------------------------------- 时间与 ID

const T = {
  p1: '2026-09-01T02:00:00Z',
  p2: '2026-09-15T08:30:00Z',
  p3: '2026-10-02T11:00:00Z',
  p4: '2026-10-20T03:15:00Z',
  p5: '2026-08-28T09:00:00Z',
  hw3: '2026-11-21T13:05:00Z',
  week6: '2026-11-19T10:00:00Z',
  tf: '2026-11-22T06:20:00Z',
  docs: '2026-11-18T07:00:00Z',
  now: '2026-11-22T06:40:00Z',
};

const PID = 'prj_dlintro';
const CID = 'cnv_transformer';
const CID_HW3 = 'cnv_backprop_hw3';

const DOC = {
  attention: 'doc_attention',
  longmem: 'doc_longmemeval',
  l05: 'doc_l05_attention',
  l04: 'doc_l04_backprop',
  tfpy: 'doc_transformer_py',
  ipynb: 'doc_train_ipynb',
  notes: 'doc_attention_notes',
  webIllustrated: 'doc_web_illustrated',
  webPytorch: 'doc_web_pytorch_sdpa',
};

// ---------------------------------------------------------------- 项目与对话

const projects: Project[] = [
  { id: PID, name: '深度学习导论', created_at: T.p1, conversation_count: 5 },
  { id: 'prj_paper_rag', name: '论文精读 · RAG', created_at: T.p2, conversation_count: 4 },
  { id: 'prj_python_da', name: 'Python 数据分析', created_at: T.p3, conversation_count: 7 },
  { id: 'prj_en_writing', name: '英语学术写作', created_at: T.p4, conversation_count: 2 },
  { id: 'prj_default', name: '默认项目', created_at: T.p5, conversation_count: 3 },
];

const convSummaries: ConversationSummary[] = [
  { id: CID, title: 'Transformer 注意力精读', updated_at: T.now, branch_count: 2 },
  { id: CID_HW3, title: '反向传播 · 作业 3', updated_at: T.hw3, branch_count: 0 },
  { id: 'cnv_week6_cards', title: '第 6 周复习卡片', updated_at: T.week6, branch_count: 0 },
];

// ---------------------------------------------------------------- 材料

const documents: Record<string, Document> = {
  [DOC.attention]: {
    id: DOC.attention,
    project_id: PID,
    kind: 'pdf',
    group: 'paper',
    title: 'Attention Is All You Need',
    pages: 15,
    parse_status: 'ready',
    progress: 100,
    cited_count: 3,
    created_at: T.docs,
  },
  [DOC.longmem]: {
    id: DOC.longmem,
    project_id: PID,
    kind: 'pdf',
    group: 'paper',
    title: 'LongMemEval.pdf',
    pages: 31,
    parse_status: 'parsing',
    progress: 62,
    cited_count: 0,
    created_at: T.now,
  },
  [DOC.l04]: {
    id: DOC.l04,
    project_id: PID,
    kind: 'pdf',
    group: 'slides', // 横版 PDF 课件，后端判为 slides（契约 v0.2），与概念图 UI-05 一致
    title: 'L04 反向传播.pdf',
    pages: 28,
    parse_status: 'ready',
    progress: 100,
    cited_count: 0,
    created_at: T.docs,
  },
  [DOC.l05]: {
    id: DOC.l05,
    project_id: PID,
    kind: 'pptx',
    group: 'slides',
    title: 'L05 注意力机制.pptx',
    pages: 32,
    parse_status: 'ready',
    progress: 100,
    cited_count: 1,
    created_at: T.docs,
  },
  [DOC.tfpy]: {
    id: DOC.tfpy,
    project_id: PID,
    kind: 'code',
    group: 'code',
    title: 'transformer.py',
    lines: 212,
    parse_status: 'ready',
    progress: 100,
    cited_count: 0,
    created_at: T.docs,
  },
  [DOC.ipynb]: {
    id: DOC.ipynb,
    project_id: PID,
    kind: 'ipynb',
    group: 'code',
    title: 'train.ipynb',
    cells: 14,
    parse_status: 'ready',
    progress: 100,
    cited_count: 0,
    created_at: T.docs,
  },
  [DOC.notes]: {
    id: DOC.notes,
    project_id: PID,
    kind: 'md',
    group: 'notes',
    title: '注意力笔记.md',
    lines: 40,
    parse_status: 'ready',
    progress: 100,
    cited_count: 0,
    created_at: T.now,
  },
  [DOC.webIllustrated]: {
    id: DOC.webIllustrated,
    project_id: PID,
    kind: 'web',
    group: 'web',
    title: 'The Illustrated Transformer',
    snapshot_id: 'ws_jalammar_illustrated',
    parse_status: 'ready',
    progress: 100,
    cited_count: 1,
    created_at: T.tf,
  },
  [DOC.webPytorch]: {
    id: DOC.webPytorch,
    project_id: PID,
    kind: 'web',
    group: 'web',
    title: 'PyTorch · scaled_dot_product_attention',
    snapshot_id: 'ws_pytorch_sdpa',
    parse_status: 'ready',
    progress: 100,
    cited_count: 1,
    created_at: T.tf,
  },
};

// ---------------------------------------------------------------- 网页快照

const WS = 'ws_jalammar_illustrated';
const snapshotText =
  'Self-Attention in Detail\n' +
  'The first step in calculating self-attention is to create three vectors from each of the encoder\u2019s input vectors. ' +
  'The second step in calculating self-attention is to calculate a score. ' +
  'The third and fourth steps are to divide the scores by 8 (the square root of the dimension of the key vectors used in the paper \u2013 64). ' +
  'This leads to having more stable gradients. ' +
  'There could be other possible values here, but this is the default, then pass the result through a softmax operation.\n';
const snapshot: WebSnapshot = {
  id: WS,
  url: 'https://jalammar.github.io/illustrated-transformer/',
  title: 'The Illustrated Transformer \u2013 Jay Alammar',
  fetched_at: '2026-11-22T06:21:04Z',
  text: snapshotText,
  sha256: sha256(snapshotText),
  http_status: 200,
};
const webQuote =
  'The third and fourth steps are to divide the scores by 8 (the square root of the dimension of the key vectors used in the paper \u2013 64). This leads to having more stable gradients.';

// ---------------------------------------------------------------- 历史对话“反向传播 · 作业 3”

const hw3Msgs: Message[] = [
  {
    id: 'msg_hw3_u2',
    conversation_id: CID_HW3,
    parent_id: 'msg_hw3_a1',
    role: 'user',
    content: '第 3 题我把初始化调大以后，loss 基本不动了，为什么？',
    created_at: '2026-11-21T13:01:00Z',
  },
  {
    id: 'msg_hw3_a2',
    conversation_id: CID_HW3,
    parent_id: 'msg_hw3_u2',
    role: 'assistant',
    content:
      '因为 sigmoid 输入很大时导数 σ(x)(1−σ(x)) 趋近 0，梯度传不回去，前面几层几乎不更新。可以把初始化调小，或者换成 ReLU 再试。',
    model: 'chat-model',
    usage: { prompt_tokens: 1820, completion_tokens: 96 },
    created_at: '2026-11-21T13:01:20Z',
    steps: [],
    citations: [],
  },
  {
    id: 'msg_hw3_u3',
    conversation_id: CID_HW3,
    parent_id: 'msg_hw3_a2',
    role: 'user',
    content: '那换成 ReLU 是不是就没有这个问题了？',
    created_at: '2026-11-21T13:03:00Z',
  },
];
const hw3Quote = 'sigmoid 输入很大时导数 σ(x)(1−σ(x)) 趋近 0，梯度传不回去';

// ---------------------------------------------------------------- 证据

interface EvidenceSeed {
  id: string;
  source_type: SourceType;
  source_id: string;
  title: string;
  locator: Locator;
  quote: string;
}

const EV: Record<'fn4' | 'l05' | 'web' | 'p5' | 'hw3' | 'code', EvidenceSeed> = {
  // F4：bbox 由 web/scripts/measure-bbox.py 用 PyMuPDF 1.26.4 对 arXiv:1706.03762v7（sha256 bdfaa68d…df697，
  // 页面 612×792 pt，MediaBox=CropBox=[0 0 612 792]，无旋转）实测：证据句逐词外接矩形求并，原点左上、单位 pt（契约 evidence-locator.md）。
  // 第 4 页脚注 4 共 3 行（含上标“4”与 Σ 的上下标）；第 5 页 h = 8 一句共 2 行。
  fn4: {
    id: 'evd_att_p4_fn4',
    source_type: 'material',
    source_id: DOC.attention,
    title: 'Attention Is All You Need',
    locator: { page: 4, sentence_ids: ['s4_fn4_1', 's4_fn4_2'], bbox: [107.8, 700.3, 504.0, 724.0] },
    quote:
      'To illustrate why the dot products get large, assume that the components of q and k are independent random variables with mean 0 and variance 1. Then their dot product, q \u00b7 k = \u03a3 q_i k_i, has mean 0 and variance d_k.',
  },
  l05: {
    id: 'evd_l05_s18',
    source_type: 'material',
    source_id: DOC.l05,
    title: 'L05 注意力机制',
    locator: { slide: 18, shape_id: 4, char_range: [0, 31] },
    quote: 'softmax 饱和：输入差距过大时输出接近 one-hot，梯度几乎为 0',
  },
  web: {
    id: 'evd_jalammar_scale',
    source_type: 'web',
    source_id: WS,
    title: 'The Illustrated Transformer',
    locator: { snapshot_id: WS, char_range: rangeOf(snapshotText, webQuote) },
    quote: webQuote,
  },
  p5: {
    id: 'evd_att_p5_heads',
    source_type: 'material',
    source_id: DOC.attention,
    title: 'Attention Is All You Need',
    locator: { page: 5, sentence_ids: ['s5_031', 's5_032'], bbox: [108.0, 234.1, 504.0, 256.0] },
    quote:
      'In this work we employ h = 8 parallel attention layers, or heads. For each of these we use d_k = d_v = d_model/h = 64.',
  },
  hw3: {
    id: 'evd_hw3_sigmoid',
    source_type: 'message',
    source_id: 'msg_hw3_a2',
    title: '反向传播 · 作业 3',
    locator: { message_id: 'msg_hw3_a2', char_range: rangeOf(hw3Msgs[1].content, hw3Quote) },
    quote: hw3Quote,
  },
  // F4 追加：transformer.py 第 7 行（与 get-documents-did-raw.ok.json 的原文一致），给代码预览的 L7 胶囊用
  code: {
    id: 'evd_tfpy_l7',
    source_type: 'material',
    source_id: DOC.tfpy,
    title: 'transformer.py',
    locator: { path: 'transformer.py', lines: [7, 7] },
    quote: 'scores = q @ k.transpose(-2, -1) / math.sqrt(d_k)',
  },
};
// pptx 的 char_range 要与 quote 长度一致
(EV.l05.locator as { char_range: [number, number] }).char_range = [0, cpLen(EV.l05.quote)];

function evidenceEvent(seed: EvidenceSeed, label: string): EventNoSeq {
  return {
    event: 'evidence',
    data: {
      eid: seed.id,
      label,
      source_type: seed.source_type,
      source_id: seed.source_id,
      title: seed.title,
      locator: seed.locator,
      quote: seed.quote,
      sha256: sha256(seed.quote),
    },
  };
}

// ---------------------------------------------------------------- 主线第 1 轮（= sse-turn-full）

const CLIENT = {
  tf1: '3f6c1a2e-8b4d-4f0a-9c57-1d2e3f4a5b60',
  tf2: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  resume: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  cancel: 'c9d8e7f6-a5b4-4c3d-8e2f-1a0b9c8d7e6f',
  error: 'd1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e5f6',
  code: 'e4f5a6b7-c8d9-4e0f-9a1b-2c3d4e5f6a7b', // F4 追加：代码问答回合
};

const q1 = '结合第 5 讲课件，讲讲注意力为什么要除以 √dₖ。最好和我上次作业卡住的地方联系起来。';
const a1Deltas = [
  // 第一句用数学斜体 𝑑（U+1D451，BMP 以外）：之后所有偏移的码点计数与 UTF-16 计数相差 1，用来检验契约 v0.2 的偏移约定
  '一句话：除以 √𝑑ₖ 是为了让点积的数值尺度不随维度变大，',
  '避免 softmax 进入梯度极小的区域。\n\n',
  '论文的推理是：假设 q 和 k 的每个分量独立、均值 0、方差 1，',
  '那么点积 q·k = Σ qᵢkᵢ 的均值是 0，方差是 dₖ[[E1]]。',
  'dₖ = 64 时标准差就是 8，softmax 的输入差距被拉得很大，输出接近 one-hot。\n\n',
  '这和你作业 3 卡住的地方是同一件事：sigmoid 输入很大时导数趋近 0；',
  '第 5 讲用的也是这个例子，softmax 饱和时梯度同样几乎为 0[[E2]]。\n\n',
  '除以 √dₖ 后点积方差回到 1，softmax 的输入落在梯度较大的区间，训练更稳定[[E3]]。',
];
const a1Content = a1Deltas.join('');

const a1Steps: Step[] = [
  {
    step_id: 'stp_tf1_1',
    kind: 'search_materials',
    label: '检索项目材料：2 份材料命中',
    status: 'done',
    duration_ms: 1240,
  },
  {
    step_id: 'stp_tf1_2',
    kind: 'recall_memory',
    label: '参考历史对话：反向传播 · 作业 3',
    status: 'done',
    duration_ms: 380,
  },
  { step_id: 'stp_tf1_3', kind: 'fetch_url', label: '抓取网页：jalammar.github.io', status: 'done', duration_ms: 2310 },
];

function cite(content: string, id: string, ev: EvidenceSeed, label: string, verdict: Citation['verdict']): Citation {
  const [s, e] = sentenceSpan(content, label);
  return { citation_id: id, eid: ev.id, label, sentence_start: s, sentence_end: e, verdict };
}

const a1Citations: Citation[] = [
  cite(a1Content, 'cit_tf1_1', EV.fn4, 'E1', 'supported'),
  cite(a1Content, 'cit_tf1_2', EV.l05, 'E2', 'partial'),
  cite(a1Content, 'cit_tf1_3', EV.web, 'E3', 'removed'),
];

function fullTurnEvents(ids: {
  message_id: string;
  client_msg_id: string;
  user_message_id: string;
  cit: string;
}): SseEvent[] {
  const running = (s: Step): EventNoSeq => ({
    event: 'step',
    data: { step_id: s.step_id, kind: s.kind, label: s.label, status: 'running' },
  });
  const done = (s: Step): EventNoSeq => ({ event: 'step', data: { ...s } });
  const cits = a1Citations.map((c, i) => ({ ...c, citation_id: `${ids.cit}_${i + 1}` }));
  return numbered([
    {
      event: 'message.start',
      data: { message_id: ids.message_id, client_msg_id: ids.client_msg_id, user_message_id: ids.user_message_id },
    },
    running(a1Steps[0]),
    done(a1Steps[0]),
    evidenceEvent(EV.fn4, 'E1'),
    evidenceEvent(EV.l05, 'E2'),
    running(a1Steps[1]),
    done(a1Steps[1]),
    running(a1Steps[2]),
    done(a1Steps[2]),
    evidenceEvent(EV.web, 'E3'),
    ...a1Deltas.map((text): EventNoSeq => ({ event: 'delta', data: { text } })),
    ...cits.map((c): EventNoSeq => ({ event: 'citation', data: c })),
    {
      event: 'message.end',
      data: {
        message_id: ids.message_id,
        usage: { prompt_tokens: 6412, completion_tokens: 318 },
        latency_ms: 9120,
        cancelled: false,
      },
    },
  ]);
}

// ---------------------------------------------------------------- 主线第 2 轮、分支

const a2Content =
  '论文用了 h = 8 个头，每个头 dₖ = dᵥ = d_model/h = 64[[E1]]。所以上面“标准差是 8”的例子正好对应原文设置。';
const branchVarQuote = '点积 q·k = Σ qᵢkᵢ 的均值是 0，方差是 dₖ';
const branchOneHotQuote = '输出接近 one-hot';
const bvA1Content =
  '拆成两步看。第一步看单独一项 qᵢkᵢ：两个独立、均值 0、方差 1 的变量相乘，E[qᵢkᵢ] = E[qᵢ]·E[kᵢ] = 0，Var(qᵢkᵢ) = E[qᵢ²]·E[kᵢ²] = 1。第二步：dₖ 项互相独立，方差直接相加，所以总方差是 dₖ，标准差是 √dₖ。除以 √dₖ，方差就回到 1[[E1]]。';

const mainMsgs: Message[] = [
  { id: 'msg_tf_u1', conversation_id: CID, role: 'user', content: q1, created_at: T.tf },
  {
    id: 'msg_tf_a1',
    conversation_id: CID,
    parent_id: 'msg_tf_u1',
    role: 'assistant',
    content: a1Content,
    model: 'chat-model',
    usage: { prompt_tokens: 6412, completion_tokens: 318 },
    created_at: '2026-11-22T06:20:09Z',
    steps: a1Steps,
    citations: a1Citations,
  },
  {
    id: 'msg_tf_u2',
    conversation_id: CID,
    parent_id: 'msg_tf_a1',
    role: 'user',
    content: '那多头注意力里，每个头的 dₖ 是多少？',
    created_at: '2026-11-22T06:38:00Z',
  },
  {
    id: 'msg_tf_a2',
    conversation_id: CID,
    parent_id: 'msg_tf_u2',
    role: 'assistant',
    content: a2Content,
    model: 'chat-model',
    usage: { prompt_tokens: 7020, completion_tokens: 64 },
    created_at: '2026-11-22T06:38:05Z',
    steps: [
      {
        step_id: 'stp_tf2_1',
        kind: 'search_materials',
        label: '检索项目材料：1 份材料命中',
        status: 'done',
        duration_ms: 910,
      },
    ],
    citations: [cite(a2Content, 'cit_tf2_1', EV.p5, 'E1', 'supported')],
  },
];

const branchVariance: Branch = {
  id: 'br_variance',
  conversation_id: CID,
  fork_message_id: 'msg_tf_a1',
  anchor_start: rangeOf(a1Content, branchVarQuote)[0],
  anchor_end: rangeOf(a1Content, branchVarQuote)[1],
  anchor_quote: branchVarQuote,
  title: '方差为什么是 dₖ',
  status: 'open',
  created_at: '2026-11-22T06:25:00Z',
  context_turns: 1,
};
const branchOneHot: Branch = {
  id: 'br_onehot',
  conversation_id: CID,
  fork_message_id: 'msg_tf_a1',
  anchor_start: rangeOf(a1Content, branchOneHotQuote)[0],
  anchor_end: rangeOf(a1Content, branchOneHotQuote)[1],
  anchor_quote: branchOneHotQuote,
  title: 'one-hot 是什么意思',
  status: 'open',
  created_at: '2026-11-22T06:31:00Z',
  context_turns: 1,
};

const branchMsgs: Message[] = [
  {
    id: 'msg_bv_u1',
    conversation_id: CID,
    parent_id: 'msg_tf_a1',
    branch_id: 'br_variance',
    role: 'user',
    content: '为什么方差正好是 dₖ？独立同分布那一步我没看懂。',
    created_at: '2026-11-22T06:25:10Z',
  },
  {
    id: 'msg_bv_a1',
    conversation_id: CID,
    parent_id: 'msg_bv_u1',
    branch_id: 'br_variance',
    role: 'assistant',
    content: bvA1Content,
    model: 'chat-model',
    usage: { prompt_tokens: 3104, completion_tokens: 142 },
    created_at: '2026-11-22T06:25:16Z',
    steps: [
      {
        step_id: 'stp_bv1_1',
        kind: 'open_source',
        label: '打开原文：Attention Is All You Need 第 4 页',
        status: 'done',
        duration_ms: 420,
      },
    ],
    citations: [cite(bvA1Content, 'cit_bv1_1', EV.fn4, 'E1', 'supported')],
  },
  {
    id: 'msg_bv_u2',
    conversation_id: CID,
    parent_id: 'msg_bv_a1',
    branch_id: 'br_variance',
    role: 'user',
    content: '如果分量的方差不是 1 呢？',
    created_at: '2026-11-22T06:27:00Z',
  },
  {
    id: 'msg_bv_a2',
    conversation_id: CID,
    parent_id: 'msg_bv_u2',
    branch_id: 'br_variance',
    role: 'assistant',
    content:
      '按同样的推导，方差会变成 dₖ·σ_q²·σ_k²，仍然随 dₖ 线性增长，所以缩放依然有用。这一条是推断：论文没有讨论方差不为 1 的情形。',
    model: 'chat-model',
    usage: { prompt_tokens: 3388, completion_tokens: 71 },
    created_at: '2026-11-22T06:27:04Z',
    steps: [],
    citations: [],
  },
  {
    id: 'msg_bo_u1',
    conversation_id: CID,
    parent_id: 'msg_tf_a1',
    branch_id: 'br_onehot',
    role: 'user',
    content: '“输出接近 one-hot”是什么意思？',
    created_at: '2026-11-22T06:31:10Z',
  },
  {
    id: 'msg_bo_a1',
    conversation_id: CID,
    parent_id: 'msg_bo_u1',
    branch_id: 'br_onehot',
    role: 'assistant',
    content: '就是 softmax 的输出几乎把全部概率放在一个位置上，其余位置接近 0，看起来像只有一个 1 的独热向量。',
    model: 'chat-model',
    usage: { prompt_tokens: 2950, completion_tokens: 48 },
    created_at: '2026-11-22T06:31:13Z',
    steps: [],
    citations: [],
  },
];

const conversation: Conversation = {
  id: CID,
  project_id: PID,
  title: 'Transformer 注意力精读',
  root_message_id: 'msg_tf_u1',
  active_leaf_id: 'msg_tf_a2',
  created_at: T.tf,
  updated_at: T.now,
};

const tree: ConversationTree = {
  conversation,
  messages: [...mainMsgs, ...branchMsgs],
  branches: [branchVariance, branchOneHot],
  active_leaf_id: 'msg_tf_a2',
};

// ---------------------------------------------------------------- 插件与 Skill

const INSTALLED_PLUGINS = ['arxiv', 'fetch', 'markitdown'];
const INSTALLED_SKILLS = ['pdf', 'literature-review'];
/** v1 完整验收的两个插件（plugin-manifest.md）；v0.3 起由市场条目的 verified 字段带出 */
const VERIFIED_PLUGINS = ['arxiv', 'fetch'];
const market = (type: MarketItem['type']): MarketList => ({
  items: MARKET_DATA.filter((m) => m.type === type).map((m) => ({
    ...m,
    installed: (type === 'plugin' ? INSTALLED_PLUGINS : INSTALLED_SKILLS).includes(m.id),
    ...(type === 'plugin' ? { verified: VERIFIED_PLUGINS.includes(m.id) } : {}),
  })),
});

const plugins: InstalledPlugin[] = [
  {
    id: 'arxiv',
    name: 'ArXiv MCP Server',
    version: '1.0.0',
    status: 'installed',
    permissions: ['network', 'fs_write'],
    config_schema: {},
    last_check_at: '2026-11-22T06:00:00Z',
    config_set: [],
    config: {},
  },
  {
    id: 'fetch',
    name: 'Fetch MCP Server',
    version: '1.0.0',
    status: 'installed',
    permissions: ['network'],
    config_schema: {},
    last_check_at: '2026-11-22T06:00:02Z',
    config_set: [],
    config: {},
  },
  {
    id: 'markitdown',
    name: 'MarkItDown MCP',
    version: '1.0.0',
    status: 'installed',
    permissions: ['fs_read'],
    config_schema: {},
    last_check_at: '2026-11-22T06:00:05Z',
    config_set: [],
    config: {},
  },
];

// ArXiv 详情：工具清单与启动参数核对自上游 README（https://github.com/blazickjp/arxiv-mcp-server ，
// 2026-11-23 取 main 分支 README，sha256 0e537bf1…；“Tools” 表写明共 19 个工具）。
// 中文说明译自 README 的 Purpose 列；顺序把概念图 UI-09 列出的常用 8 个放前面，其余按 README 顺序。
// tools_allow：semantic_search、reindex 在 README 中标注 “Requires [pro]”（需额外安装本地向量依赖），v1 不开放，其余 17 个开放。
// --storage-path 是 README 的启动参数，Mnemosyne 指到自己的插件目录（plugin-manifest.md 示例）。
const ARXIV_TOOLS: PluginDetail['tools'] = [
  { name: 'search_papers', description: '按关键词、分类、日期和排序检索 arXiv' },
  { name: 'get_abstract', description: '按 arXiv ID 取元数据与摘要，不下载全文' },
  { name: 'download_paper', description: '下载论文并转成本地 Markdown' },
  { name: 'get_paper_outline', description: '分页返回论文的章节目录' },
  { name: 'read_paper_section', description: '读取某一节正文（有长度上限）' },
  { name: 'search_paper_text', description: '在单篇论文内检索段落，返回原文偏移' },
  { name: 'export_citations', description: '为一个或多个 arXiv ID 导出 BibTeX' },
  { name: 'citation_graph', description: '查参考文献与被引（经 Semantic Scholar）' },
  { name: 'list_papers', description: '列出本地已保存的论文' },
  { name: 'read_paper', description: '读取本地已保存论文的正文（有长度上限）' },
  { name: 'get_paper_latex', description: '读取作者提交的 LaTeX 源（有长度上限）' },
  { name: 'list_paper_latex_sections', description: '分页返回 LaTeX 章节目录' },
  { name: 'get_paper_latex_section', description: '读取 LaTeX 的某一节（有长度上限）' },
  { name: 'watch_topic', description: '保存或更新一个 arXiv 主题订阅' },
  { name: 'list_watches', description: '列出已保存的主题订阅' },
  { name: 'check_alerts', description: '检查订阅的主题有没有新论文' },
  { name: 'unwatch_topic', description: '删除一个主题订阅' },
  { name: 'semantic_search', description: '按语义相似度检索已下载的论文（需 [pro] 依赖）' },
  { name: 'reindex', description: '重建本地语义索引（需 [pro] 依赖）' },
];
const ARXIV_PRO_ONLY = ['semantic_search', 'reindex'];

const arxivDetail: PluginDetail = {
  ...plugins[0],
  verified: true,
  tools: ARXIV_TOOLS,
  manifest: {
    transport: 'stdio',
    command: 'uvx',
    args: ['arxiv-mcp-server', '--storage-path', '~/.mnemosyne/plugins/arxiv'],
    tools_allow: ARXIV_TOOLS.map((t) => t.name).filter((n) => !ARXIV_PRO_ONLY.includes(n)),
  },
  about_zh:
    '查找 arXiv 预印本并读论文。论文下载到本地后按章节读取，适合精读时边问边查原文；返回的题录、章节文本会作为证据进入回答，带 arXiv ID 和章节位置。',
  usage_zh:
    '在对话里直接问“帮我找 2024 年以后关于长程记忆评测的 arXiv 论文”，助手会调用 search_papers；让它下载某篇论文后，回答里的引用会定位到对应章节。也可以在输入框的“插件”弹层里按对话关闭它。',
  permission_notes: {
    network: '访问 arXiv 与 Semantic Scholar',
    fs_write: '仅限论文存放目录（--storage-path）',
  },
};

const skillOf = (id: string, enabled: boolean): Skill => {
  const m = MARKET_DATA.find((x) => x.id === id);
  if (!m) throw new Error(`市场里没有 ${id}`);
  return {
    id,
    name: m.name,
    description: m.desc_zh,
    dir_path: `~/.mnemosyne/skills/${m.name}`,
    source_url: m.repo_url,
    license: m.license,
    enabled,
  };
};
const skills: Skill[] = [skillOf('pdf', true), skillOf('literature-review', false)];
const pdfSkillDetail: SkillDetail = {
  ...skills[0],
  skill_md: `---\nname: pdf\ndescription: ${skills[0].description}\nlicense: Apache-2.0\n---\n\n（fixture 占位：正文以安装时从仓库读取的 SKILL.md 为准）\n`,
  files: ['SKILL.md', 'LICENSE.txt'],
};

// ---------------------------------------------------------------- 设置与记忆

const settings: Settings = {
  chat_model: 'chat-model',
  small_model: 'small-model',
  embedding_model: 'embedding-model',
  api_base: 'https://api.example.com/v1',
  api_key_set: false,
  web_search_default: false,
  memory_enabled: true,
};

const memoryItems: MemoryItem[] = [
  {
    id: 'mem_hw3_sigmoid',
    scope: 'project',
    scope_id: PID,
    topic: '反向传播',
    content: '作业 3 卡在 sigmoid 饱和：输入很大时导数趋近 0，梯度传不回去。',
    source_message_ids: ['msg_hw3_a2'],
    status: 'active',
    valid_from: T.hw3,
    confidence: 0.86,
    source_conversation_id: CID_HW3,
  },
  {
    id: 'mem_pref_conclusion',
    scope: 'global',
    topic: '回答偏好',
    content: '希望先给一句话结论，再展开推导。',
    source_message_ids: ['msg_tf_u1'],
    status: 'active',
    valid_from: T.tf,
    confidence: 0.7,
    source_conversation_id: CID,
  },
  {
    id: 'mem_br_variance',
    scope: 'branch',
    scope_id: 'br_variance',
    topic: '注意力缩放',
    content: '已理解点积方差等于 dₖ 的两步推导：单项方差为 1，独立项方差相加。',
    source_message_ids: ['msg_bv_a1'],
    status: 'active',
    valid_from: '2026-11-22T06:25:16Z',
    confidence: 0.8,
    source_conversation_id: CID,
  },
];

// ================================================================ 写 fixtures

// ---- 项目与对话
ok<ProjectList>('GET /api/projects', '项目栏：5 个项目', undefined, { projects });
err('GET /api/projects', '数据库读取失败', undefined, 'INTERNAL', '读取项目列表失败，请稍后重试');

ok<Project>(
  'POST /api/projects',
  '新建项目',
  { body: { name: '强化学习' } satisfies CreateProjectBody },
  { id: 'prj_rl', name: '强化学习', created_at: T.now, conversation_count: 0 },
);
err(
  'POST /api/projects',
  '项目名为空',
  { body: { name: '' } satisfies CreateProjectBody },
  'VALIDATION_ERROR',
  '项目名需为 1–60 个字',
);

ok<ConversationPage>(
  'GET /api/projects/{pid}/conversations',
  '“深度学习导论”的对话列表第一页（limit=3，还有更多）',
  { params: { pid: PID }, query: { limit: '3' } },
  { conversations: convSummaries, next_cursor: 'cur_3' },
);
err(
  'GET /api/projects/{pid}/conversations',
  '项目不存在',
  { params: { pid: 'prj_missing' } },
  'NOT_FOUND',
  '项目不存在',
);

ok<Conversation>(
  'POST /api/projects/{pid}/conversations',
  '新建对话（尚无消息）',
  { params: { pid: PID }, body: {} satisfies CreateConversationBody },
  { id: 'cnv_new', project_id: PID, title: '新对话', created_at: T.now, updated_at: T.now },
);
err(
  'POST /api/projects/{pid}/conversations',
  '项目不存在',
  { params: { pid: 'prj_missing' }, body: {} },
  'NOT_FOUND',
  '项目不存在',
);

ok<ConversationTree>(
  'GET /api/conversations/{cid}/tree',
  '“Transformer 注意力精读”：主线 2 轮 + 2 个分支（UI-05/06）',
  { params: { cid: CID } },
  tree,
);
err('GET /api/conversations/{cid}/tree', '对话不存在', { params: { cid: 'cnv_missing' } }, 'NOT_FOUND', '对话不存在');

ok<ActiveLeafResult>(
  'PUT /api/conversations/{cid}/active_leaf',
  '切换到重新生成的兄弟回答',
  { params: { cid: CID }, body: { message_id: 'msg_tf_a1b' } satisfies SetActiveLeafBody },
  { active_leaf_id: 'msg_tf_a1b' },
);
err(
  'PUT /api/conversations/{cid}/active_leaf',
  '目标不是可切换的兄弟回答',
  { params: { cid: CID }, body: { message_id: 'msg_bv_a1' } satisfies SetActiveLeafBody },
  'VALIDATION_ERROR',
  'message_id 不是当前回答的兄弟节点',
);

// ---- 消息（SSE）
const sendBody1: SendMessageBody = { client_msg_id: CLIENT.tf1, content: q1, web_search: true, scope: { mode: 'all' } };
sse(
  'sse-turn-full.json',
  'POST /api/conversations/{cid}/messages',
  '完整回合：3 个步骤、3 条证据、8 段正文、3 条引用（supported / partial / removed）、message.end',
  { params: { cid: CID }, body: sendBody1 },
  fullTurnEvents({ message_id: 'msg_tf_a1', client_msg_id: CLIENT.tf1, user_message_id: 'msg_tf_u1', cit: 'cit_tf1' }),
);
err(
  'POST /api/conversations/{cid}/messages',
  '正文为空',
  { params: { cid: CID }, body: { ...sendBody1, client_msg_id: CLIENT.error, content: '' } satisfies SendMessageBody },
  'VALIDATION_ERROR',
  '消息内容不能为空',
);

// F4 追加：@ 引用 transformer.py 提问的回合。引用代码第 7 行（L7）、历史对话“作业 3”与网页快照，三条都 supported，
// 让代码预览、历史对话预览、网页快照预览都能从对话里的胶囊打开（mocks/chat-world.ts 按 @ 引用选用本回合）。
const qCode = '@transformer.py 第 7 行在算什么？';
const codeDeltas = [
  '第 7 行先算 q 和每个 k 的点积，再除以 √dₖ 做缩放[[E1]]。',
  '不缩放时 softmax 容易饱和，和你作业 3 里 sigmoid 输入太大、梯度传不回去是同一类问题[[E2]]。',
  'The Illustrated Transformer 里也是先把分数除以 8 再做 softmax，梯度更稳定[[E3]]。',
];
const codeContent = codeDeltas.join('');
const codeSteps: Step[] = [
  {
    step_id: 'stp_code_1',
    kind: 'search_materials',
    label: '检索项目材料：1 份材料命中',
    status: 'done',
    duration_ms: 640,
  },
  {
    step_id: 'stp_code_2',
    kind: 'recall_memory',
    label: '参考历史对话：反向传播 · 作业 3',
    status: 'done',
    duration_ms: 310,
  },
];
sse(
  'sse-turn-code.json',
  'POST /api/conversations/{cid}/messages',
  '代码问答回合（F4）：@ transformer.py 提问，引用代码第 7 行、历史对话“作业 3”、网页快照，3 条引用均 supported',
  {
    params: { cid: CID },
    body: {
      client_msg_id: CLIENT.code,
      content: qCode,
      web_search: false,
      scope: { mode: 'selected', document_ids: [DOC.tfpy] },
    } satisfies SendMessageBody,
  },
  numbered([
    {
      event: 'message.start',
      data: { message_id: 'msg_code_a1', client_msg_id: CLIENT.code, user_message_id: 'msg_code_u1' },
    },
    { event: 'step', data: { ...codeSteps[0], status: 'running' } },
    { event: 'step', data: { ...codeSteps[0] } },
    evidenceEvent(EV.code, 'E1'),
    { event: 'step', data: { ...codeSteps[1], status: 'running' } },
    { event: 'step', data: { ...codeSteps[1] } },
    evidenceEvent(EV.hw3, 'E2'),
    evidenceEvent(EV.web, 'E3'),
    ...codeDeltas.map((text): EventNoSeq => ({ event: 'delta', data: { text } })),
    { event: 'citation', data: cite(codeContent, 'cit_code_1', EV.code, 'E1', 'supported') },
    { event: 'citation', data: cite(codeContent, 'cit_code_2', EV.hw3, 'E2', 'supported') },
    { event: 'citation', data: cite(codeContent, 'cit_code_3', EV.web, 'E3', 'supported') },
    {
      event: 'message.end',
      data: {
        message_id: 'msg_code_a1',
        usage: { prompt_tokens: 2210, completion_tokens: 142 },
        latency_ms: 4630,
        cancelled: false,
      },
    },
  ]),
);

const resumeEvents = fullTurnEvents({
  message_id: 'msg_rs_a1',
  client_msg_id: CLIENT.resume,
  user_message_id: 'msg_rs_u1',
  cit: 'cit_rs1',
});
sse(
  'sse-turn-resume.json',
  'POST /api/conversations/{cid}/messages',
  '续流回合：服务端推完第 5 个事件后断线；前端用 GET /api/messages/msg_rs_a1/events?after_seq=5 取回其余事件（见 get-messages-mid-events.ok.json）',
  {
    params: { cid: 'cnv_resume_demo' },
    body: { ...sendBody1, client_msg_id: CLIENT.resume } satisfies SendMessageBody,
  },
  resumeEvents,
  5,
);
sse(
  'get-messages-mid-events.ok.json',
  'GET /api/messages/{mid}/events',
  '断线续流：after_seq=5，补发第 6 个事件起直到 message.end',
  { params: { mid: 'msg_rs_a1' }, query: { after_seq: '5' } },
  resumeEvents.filter((e) => e.data.seq > 5),
);
err(
  'GET /api/messages/{mid}/events',
  '消息不存在',
  { params: { mid: 'msg_missing' }, query: { after_seq: '0' } },
  'NOT_FOUND',
  '消息不存在',
);

const cancelPartialText = '论文用了 h = 8 个头，每个头 dₖ = dᵥ = d_model/h = 64[[E1]]。所以上面“标准差是 8”的例子';
sse(
  'sse-turn-cancel.json',
  'POST /api/conversations/{cid}/messages',
  '取消回合：生成到一半用户点停止；未校验的引用以 partial 发出，然后 message.end(cancelled=true)',
  {
    params: { cid: CID },
    body: {
      client_msg_id: CLIENT.cancel,
      content: '那多头注意力里，每个头的 dₖ 是多少？',
      parent_id: 'msg_tf_a1',
      web_search: false,
      scope: { mode: 'all' },
    } satisfies SendMessageBody,
  },
  numbered([
    {
      event: 'message.start',
      data: {
        message_id: 'msg_cx_a1',
        client_msg_id: CLIENT.cancel,
        user_message_id: 'msg_cx_u1',
        parent_id: 'msg_tf_a1',
      },
    },
    {
      event: 'step',
      data: { step_id: 'stp_cx_1', kind: 'search_materials', label: '检索项目材料', status: 'running' },
    },
    {
      event: 'step',
      data: {
        step_id: 'stp_cx_1',
        kind: 'search_materials',
        label: '检索项目材料：1 份材料命中',
        status: 'done',
        duration_ms: 880,
      },
    },
    evidenceEvent(EV.p5, 'E1'),
    { event: 'delta', data: { text: '论文用了 h = 8 个头，每个头 dₖ = dᵥ = d_model/h = 64[[E1]]。' } },
    { event: 'delta', data: { text: '所以上面“标准差是 8”的例子' } },
    { event: 'citation', data: cite(cancelPartialText, 'cit_cx_1', EV.p5, 'E1', 'partial') },
    {
      event: 'message.end',
      data: {
        message_id: 'msg_cx_a1',
        usage: { prompt_tokens: 7020, completion_tokens: 31 },
        latency_ms: 2140,
        cancelled: true,
      },
    },
  ]),
);
sse(
  'sse-turn-error.json',
  'POST /api/conversations/{cid}/messages',
  '失败回合：模型接口不可用，发 error 后不再有 message.end',
  { params: { cid: CID }, body: { ...sendBody1, client_msg_id: CLIENT.error } satisfies SendMessageBody },
  numbered([
    {
      event: 'message.start',
      data: { message_id: 'msg_er_a1', client_msg_id: CLIENT.error, user_message_id: 'msg_er_u1' },
    },
    {
      event: 'step',
      data: { step_id: 'stp_er_1', kind: 'search_materials', label: '检索项目材料', status: 'running' },
    },
    {
      event: 'step',
      data: {
        step_id: 'stp_er_1',
        kind: 'search_materials',
        label: '检索项目材料：2 份材料命中',
        status: 'done',
        duration_ms: 1100,
      },
    },
    {
      event: 'error',
      data: { code: 'MODEL_UNAVAILABLE', message: '模型接口不可用，请检查设置里的 API Key', retriable: true },
    },
  ]),
);

ok<OkResult>('POST /api/messages/{mid}/cancel', '取消生成', { params: { mid: 'msg_cx_a1' } }, { ok: true });
err('POST /api/messages/{mid}/cancel', '消息不存在', { params: { mid: 'msg_missing' } }, 'NOT_FOUND', '消息不存在');

const regenText = [
  '除以 √dₖ 是为了把点积的方差拉回 1：',
  '论文假设各分量独立、均值 0、方差 1，点积方差因此是 dₖ[[E1]]。',
];
sse(
  'post-messages-mid-regenerate.ok.json',
  'POST /api/messages/{mid}/regenerate',
  '重新生成主线第 1 条回答，新回答 msg_tf_a1b 是 msg_tf_a1 的兄弟节点',
  { params: { mid: 'msg_tf_a1' } },
  numbered([
    {
      event: 'message.start',
      data: { message_id: 'msg_tf_a1b', client_msg_id: CLIENT.tf1, user_message_id: 'msg_tf_u1' },
    },
    {
      event: 'step',
      data: { step_id: 'stp_tf1b_1', kind: 'search_materials', label: '检索项目材料', status: 'running' },
    },
    {
      event: 'step',
      data: {
        step_id: 'stp_tf1b_1',
        kind: 'search_materials',
        label: '检索项目材料：1 份材料命中',
        status: 'done',
        duration_ms: 1020,
      },
    },
    evidenceEvent(EV.fn4, 'E1'),
    ...regenText.map((text): EventNoSeq => ({ event: 'delta', data: { text } })),
    { event: 'citation', data: cite(regenText.join(''), 'cit_tf1b_1', EV.fn4, 'E1', 'supported') },
    {
      event: 'message.end',
      data: {
        message_id: 'msg_tf_a1b',
        usage: { prompt_tokens: 6380, completion_tokens: 52 },
        latency_ms: 4210,
        cancelled: false,
      },
    },
  ]),
);
err(
  'POST /api/messages/{mid}/regenerate',
  '模型接口不可用',
  { params: { mid: 'msg_tf_a1' } },
  'MODEL_UNAVAILABLE',
  '模型接口不可用，请检查设置里的 API Key',
);

// ---- 分支
const newBranchQuote = 'softmax 饱和时梯度同样几乎为 0';
const [nbStart, nbEnd] = rangeOf(a1Content, newBranchQuote);
ok<Branch>(
  'POST /api/branches',
  '就“softmax 饱和时梯度同样几乎为 0”开分支',
  {
    body: {
      conversation_id: CID,
      fork_message_id: 'msg_tf_a1',
      anchor: { start: nbStart, end: nbEnd, quote: newBranchQuote },
    } satisfies CreateBranchBody,
  },
  {
    id: 'br_saturation',
    conversation_id: CID,
    fork_message_id: 'msg_tf_a1',
    anchor_start: nbStart,
    anchor_end: nbEnd,
    anchor_quote: newBranchQuote,
    title: newBranchQuote,
    status: 'open',
    created_at: T.now,
    context_turns: 1,
  },
);
err(
  'POST /api/branches',
  '锚点越界',
  {
    body: {
      conversation_id: CID,
      fork_message_id: 'msg_tf_a1',
      anchor: { start: 900, end: 920, quote: '不存在的片段' },
    } satisfies CreateBranchBody,
  },
  'VALIDATION_ERROR',
  'anchor 超出回答正文范围',
);

const mergeNote: Message = {
  id: 'msg_tf_merge1',
  conversation_id: CID,
  parent_id: 'msg_tf_a2',
  role: 'merge_note',
  content: '分支「方差为什么是 dₖ」要点：单项 qᵢkᵢ 方差为 1，dₖ 个独立项方差相加得 dₖ，除以 √dₖ 后回到 1。',
  created_at: T.now,
};
ok<MergeResult>(
  'POST /api/branches/{bid}/merge',
  '把分支“方差为什么是 dₖ”的要点合并到主线',
  { params: { bid: 'br_variance' } },
  { branch: { ...branchVariance, status: 'merged', merged_into_message_id: mergeNote.id }, merge_note: mergeNote },
);
err('POST /api/branches/{bid}/merge', '分支不存在', { params: { bid: 'br_missing' } }, 'NOT_FOUND', '分支不存在');

ok<Branch>(
  'PUT /api/branches/{bid}',
  '归档分支',
  { params: { bid: 'br_onehot' }, body: { status: 'archived' } satisfies UpdateBranchBody },
  { ...branchOneHot, status: 'archived' },
);
ok<Branch>(
  'PUT /api/branches/{bid}',
  '重命名分支',
  { params: { bid: 'br_variance' }, body: { title: '点积方差推导' } satisfies UpdateBranchBody },
  { ...branchVariance, title: '点积方差推导' },
  'rename',
);
err(
  'PUT /api/branches/{bid}',
  '标题为空',
  { params: { bid: 'br_variance' }, body: { title: '' } satisfies UpdateBranchBody },
  'VALIDATION_ERROR',
  '分支标题不能为空',
);

// ---- 材料与证据
const docsByGroup = (group: Document['group']) => Object.values(documents).filter((d) => d.group === group);
ok<DocumentGroups>(
  'GET /api/projects/{pid}/documents',
  '文件栏：按 group 分组，顺序 paper、slides、code、notes、web（横版 PDF“L04 反向传播”进 slides）',
  { params: { pid: PID } },
  {
    groups: [
      { group: 'paper', documents: docsByGroup('paper') },
      { group: 'slides', documents: docsByGroup('slides') },
      { group: 'code', documents: docsByGroup('code') },
      { group: 'notes', documents: docsByGroup('notes') },
      { group: 'web', documents: docsByGroup('web') },
    ],
  },
);
err('GET /api/projects/{pid}/documents', '项目不存在', { params: { pid: 'prj_missing' } }, 'NOT_FOUND', '项目不存在');

ok<UploadResult>(
  'POST /api/projects/{pid}/documents',
  '上传 1 个课件，进入解析队列',
  { params: { pid: PID }, files: ['L06 位置编码.pptx'] },
  {
    documents: [
      {
        id: 'doc_l06_posenc',
        project_id: PID,
        kind: 'pptx',
        group: 'slides',
        title: 'L06 位置编码.pptx',
        parse_status: 'queued',
        progress: 0,
        cited_count: 0,
        created_at: T.now,
      },
    ],
    job_ids: ['job_parse_l06'],
  },
);
err(
  'POST /api/projects/{pid}/documents',
  '不支持的文件类型',
  { params: { pid: PID }, files: ['作业3.docx'] },
  'VALIDATION_ERROR',
  '暂不支持 .docx，请上传 PDF、PPTX、代码、Notebook 或 Markdown',
);

ok<Document>(
  'GET /api/documents/{did}',
  '解析中的论文（62%）',
  { params: { did: DOC.longmem } },
  documents[DOC.longmem],
);
err('GET /api/documents/{did}', '材料不存在', { params: { did: 'doc_missing' } }, 'NOT_FOUND', '材料不存在');

files.push({
  file: 'get-documents-did-raw.ok.json',
  content: {
    endpoint: 'GET /api/documents/{did}/raw',
    kind: 'ok',
    description: '代码文件原文（text/plain）。PDF/PPTX 返回二进制，F0 不放二进制样例',
    request: { params: { did: DOC.tfpy } },
    status: 200,
    content_type: 'text/plain',
    body: [
      'import math',
      'import torch',
      '',
      '',
      'def scaled_dot_product_attention(q, k, v, mask=None):',
      '    d_k = q.size(-1)',
      '    scores = q @ k.transpose(-2, -1) / math.sqrt(d_k)',
      '    if mask is not None:',
      '        scores = scores.masked_fill(mask == 0, float("-inf"))',
      '    weights = torch.softmax(scores, dim=-1)',
      '    return weights @ v, weights',
      '',
    ].join('\n'),
  },
});
err('GET /api/documents/{did}/raw', '材料不存在', { params: { did: 'doc_missing' } }, 'NOT_FOUND', '材料不存在');

// F4 追加：笔记（Markdown，text/plain）与 Notebook（ipynb 原文件）的 raw 样例，给右栏代码/文档预览用。
// PDF 与 PPTX（转换后的 PDF）是二进制，由 mocks/preview-world.ts 从 web/public/samples/ 取文件应答，不进 fixture。
const notesMd = [
  '# 注意力笔记',
  '',
  '## 1. 缩放点积注意力',
  '',
  '$$\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V$$',
  '',
  '- Q、K 的维度是 $d_k$，V 的维度是 $d_v$。',
  '- 每个 query 和所有 key 做点积，得到一行分数。',
  '- 分数除以 $\\sqrt{d_k}$ 后再过 softmax。',
  '',
  '## 2. 为什么要除以 √dₖ',
  '',
  '假设 q、k 的每个分量独立、均值 0、方差 1：',
  '',
  '1. 单项 $q_i k_i$ 的均值是 0，方差是 1。',
  '2. $d_k$ 项相加，点积的方差是 $d_k$，标准差是 $\\sqrt{d_k}$。',
  '3. $d_k = 64$ 时标准差是 8，softmax 的输入差距被拉大。',
  '',
  '> softmax 饱和后输出接近 one-hot，梯度几乎为 0。',
  '',
  '## 3. 和作业 3 的联系',
  '',
  '- sigmoid 输入很大时导数趋近 0，和 softmax 饱和是同一件事。',
  '- 解决思路都是把输入拉回梯度较大的区间。',
  '',
  '## 4. 多头注意力',
  '',
  '| 参数 | 取值 |',
  '| --- | --- |',
  '| $h$ | 8 |',
  '| $d_{model}$ | 512 |',
  '| $d_k = d_v$ | 64 |',
  '',
  '```python',
  'scores = q @ k.transpose(-2, -1) / math.sqrt(d_k)',
  '```',
  '',
  '## 待复习',
  '',
  '- 位置编码为什么用正弦余弦。',
].join('\n');
files.push({
  file: 'get-documents-did-raw.md.ok.json',
  content: {
    endpoint: 'GET /api/documents/{did}/raw',
    kind: 'ok',
    description: 'Markdown 笔记原文（text/plain，40 行）',
    request: { params: { did: DOC.notes } },
    status: 200,
    content_type: 'text/plain',
    body: notesMd,
  },
});

const nbCell = (cell_type: 'markdown' | 'code', source: string[], outputs?: string[]) =>
  cell_type === 'markdown'
    ? { cell_type, metadata: {}, source: source.map((l, i) => (i < source.length - 1 ? `${l}\n` : l)) }
    : {
        cell_type,
        execution_count: null,
        metadata: {},
        source: source.map((l, i) => (i < source.length - 1 ? `${l}\n` : l)),
        outputs: (outputs ?? []).map((text) => ({ output_type: 'stream', name: 'stdout', text: [text] })),
      };
const trainNotebook = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } },
  cells: [
    nbCell('markdown', ['# 训练一个小 Transformer', '', '用玩具数据验证缩放点积注意力。']),
    nbCell('code', ['import math', 'import torch', 'from transformer import scaled_dot_product_attention']),
    nbCell('markdown', ['## 1. 数据']),
    nbCell('code', [
      'torch.manual_seed(0)',
      'q = torch.randn(2, 4, 64)',
      'k = torch.randn(2, 4, 64)',
      'v = torch.randn(2, 4, 64)',
    ]),
    nbCell('markdown', ['## 2. 不缩放时的分数尺度']),
    nbCell('code', ['raw = q @ k.transpose(-2, -1)', 'print(raw.std().item())'], ['8.03\n']),
    nbCell('markdown', ['## 3. 缩放后']),
    nbCell(
      'code',
      ['out, w = scaled_dot_product_attention(q, k, v)', 'print(w.max(dim=-1).values.mean().item())'],
      ['0.61\n'],
    ),
    nbCell('markdown', ['## 4. 对照：不除以 √dₖ']),
    nbCell('code', ['w_raw = torch.softmax(raw, dim=-1)', 'print(w_raw.max(dim=-1).values.mean().item())'], ['0.97\n']),
    nbCell('markdown', ['不缩放时权重接近 one-hot。']),
    nbCell('code', ['loss = out.pow(2).mean()', 'loss.backward()']),
    nbCell('markdown', ['## 5. 小结']),
    nbCell('code', ['print("done")'], ['done\n']),
  ],
};
files.push({
  file: 'get-documents-did-raw.ipynb.ok.json',
  content: {
    endpoint: 'GET /api/documents/{did}/raw',
    kind: 'ok',
    description: 'Notebook 原文件（ipynb JSON，14 个单元格）',
    request: { params: { did: DOC.ipynb } },
    status: 200,
    content_type: 'text/plain', // code 组（含 ipynb）按 rest-api.md 返回 text/plain，正文为 .ipynb 的 JSON 文本
    body: `${JSON.stringify(trainNotebook, null, 1)}\n`,
  },
});

ok<JobResult>(
  'POST /api/documents/{did}/reparse',
  '重新解析',
  { params: { did: DOC.longmem } },
  { job_id: 'job_reparse_longmem' },
);
err(
  'POST /api/documents/{did}/reparse',
  '加密 PDF 无法解析',
  { params: { did: DOC.longmem } },
  'PARSE_FAILED',
  'PDF 已加密，无法提取文字',
);

const evidenceFull = (
  seed: EvidenceSeed,
  cited_by: { message_id: string; label: string }[],
  extra: Partial<Evidence> = {},
): Evidence => ({
  id: seed.id,
  source_type: seed.source_type,
  source_id: seed.source_id,
  title: seed.title,
  locator: seed.locator,
  quote: seed.quote,
  sha256: sha256(seed.quote),
  cited_by,
  ...extra,
});
ok<Evidence>(
  'GET /api/evidence/{eid}',
  '论文第 4 页脚注 4（UI-06 证据 1）',
  { params: { eid: EV.fn4.id } },
  evidenceFull(EV.fn4, [
    { message_id: 'msg_tf_a1', label: 'E1' },
    { message_id: 'msg_bv_a1', label: 'E1' },
  ]),
);
ok<Evidence>(
  'GET /api/evidence/{eid}',
  '课件 L05 第 18 页',
  { params: { eid: EV.l05.id } },
  evidenceFull(EV.l05, [{ message_id: 'msg_tf_a1', label: 'E2' }]),
  'pptx',
);
ok<Evidence>(
  'GET /api/evidence/{eid}',
  'jalammar.github.io 网页快照',
  { params: { eid: EV.web.id } },
  evidenceFull(EV.web, [{ message_id: 'msg_tf_a1', label: 'E3' }]),
  'web',
);
ok<Evidence>(
  'GET /api/evidence/{eid}',
  '历史对话“反向传播 · 作业 3”的一段回答；context_messages 含被引消息及其前后各 1 条',
  { params: { eid: EV.hw3.id } },
  evidenceFull(EV.hw3, [], { context_messages: hw3Msgs }),
  'message',
);
ok<Evidence>(
  'GET /api/evidence/{eid}',
  'transformer.py 第 7 行（F4 追加，代码预览的 L7 胶囊）',
  { params: { eid: EV.code.id } },
  evidenceFull(EV.code, [{ message_id: 'msg_code_a1', label: 'E1' }]),
  'code',
);
err(
  'GET /api/evidence/{eid}',
  '证据来自兄弟分支，不在当前路径上',
  { params: { eid: 'evd_sibling_branch' } },
  'NOT_VISIBLE_ON_PATH',
  '该证据不在当前分支路径上',
);

ok<WebSnapshot>(
  'GET /api/web_snapshots/{sid}',
  'The Illustrated Transformer 快照（文本为样例摘录）',
  { params: { sid: WS } },
  snapshot,
);
err(
  'GET /api/web_snapshots/{sid}',
  '快照属于兄弟分支',
  { params: { sid: 'ws_sibling_branch' } },
  'NOT_VISIBLE_ON_PATH',
  '该网页快照不在当前分支路径上',
);

// ---- 市场、插件与 Skill
ok<MarketList>(
  'GET /api/market/plugins',
  '插件市场 18 条（来自 03-调研，星数查询日 2026-11-21）',
  undefined,
  market('plugin'),
);
err('GET /api/market/plugins', 'registry 读取失败', undefined, 'INTERNAL', '读取插件市场失败');
ok<MarketList>(
  'GET /api/market/skills',
  'Skill 市场 12 条（来自 03-调研，星数查询日 2026-11-21）',
  undefined,
  market('skill'),
);
err('GET /api/market/skills', 'registry 读取失败', undefined, 'INTERNAL', '读取 Skill 市场失败');

ok<PluginList>('GET /api/plugins', '已安装 3 个插件', undefined, { plugins });
err('GET /api/plugins', '读取失败', undefined, 'INTERNAL', '读取已安装插件失败');

ok<PluginDetail>(
  'GET /api/plugins/{id}',
  'ArXiv 插件详情（v1 完整验收的两个插件之一）',
  { params: { id: 'arxiv' } },
  arxivDetail,
);
ok<PluginDetail>(
  'GET /api/plugins/{id}',
  '未安装的 Tavily：字段取自市场 manifest 与上游工具清单，status=not_installed（工具描述为样例，接入时以实测为准）',
  { params: { id: 'tavily' } },
  {
    id: 'tavily',
    name: 'Tavily MCP',
    version: '1.0.0',
    status: 'not_installed',
    permissions: ['network'],
    config_schema: { TAVILY_API_KEY: { required: true, secret: true, label: 'Tavily API Key' } },
    verified: false,
    tools: [
      { name: 'tavily-search', description: '实时网页检索' },
      { name: 'tavily-extract', description: '抽取指定网页的正文' },
    ],
  },
  'not-installed',
);
err('GET /api/plugins/{id}', '插件不存在', { params: { id: 'missing-plugin' } }, 'NOT_FOUND', '插件不存在');

ok<InstalledPlugin>(
  'POST /api/plugins/{id}',
  '安装 Fetch 插件并通过自检',
  { params: { id: 'fetch' }, body: { config: {} } satisfies InstallPluginBody },
  plugins[1],
);
err(
  'POST /api/plugins/{id}',
  '启动后 tools/list 失败',
  { params: { id: 'docling' }, body: { config: {} } satisfies InstallPluginBody },
  'PLUGIN_SELF_CHECK_FAILED',
  '插件启动失败：tools/list 在 30 s 内没有返回',
  {
    log_tail:
      '[docling-mcp] starting server (stdio)\n[docling-mcp] loading models…\n[mnemosyne] tools/list timed out after 30000 ms',
  },
);

ok<OkResult>('DELETE /api/plugins/{id}', '卸载插件', { params: { id: 'markitdown' } }, { ok: true });
err('DELETE /api/plugins/{id}', '插件未安装', { params: { id: 'missing-plugin' } }, 'NOT_FOUND', '插件未安装');

ok<ConversationPluginList>(
  'GET /api/conversations/{cid}/plugins',
  '本对话启用的插件（输入框上方：网页检索 · PDF 解析 · arXiv）',
  { params: { cid: CID } },
  { plugins: plugins.map((p) => ({ plugin_id: p.id, enabled: true, status: p.status })) },
);
err(
  'GET /api/conversations/{cid}/plugins',
  '对话不存在',
  { params: { cid: 'cnv_missing' } },
  'NOT_FOUND',
  '对话不存在',
);

ok<ConversationPluginList>(
  'PUT /api/conversations/{cid}/plugins',
  '关掉 PDF 解析插件',
  {
    params: { cid: CID },
    body: { enabled_plugin_ids: ['arxiv', 'fetch'] } satisfies SetConversationPluginsBody,
  },
  { plugins: plugins.map((p) => ({ plugin_id: p.id, enabled: p.id !== 'markitdown', status: p.status })) },
);
err(
  'PUT /api/conversations/{cid}/plugins',
  '包含未安装的插件',
  { params: { cid: CID }, body: { enabled_plugin_ids: ['tavily'] } satisfies SetConversationPluginsBody },
  'VALIDATION_ERROR',
  '插件 tavily 未安装',
);

ok<SkillList>('GET /api/skills', '已导入 2 个 Skill', undefined, { skills });
err('GET /api/skills', '读取失败', undefined, 'INTERNAL', '读取 Skill 列表失败');

ok<SkillDetail>('GET /api/skills/{id}', 'pdf Skill 详情', { params: { id: 'pdf' } }, pdfSkillDetail);
err('GET /api/skills/{id}', 'Skill 不存在', { params: { id: 'missing-skill' } }, 'NOT_FOUND', 'Skill 不存在');

const peerReviewUrl = MARKET_DATA.find((m) => m.id === 'peer-review')?.repo_url ?? '';
ok<Skill>(
  'POST /api/skills/import',
  '从 GitHub 导入 peer-review',
  { body: { source: 'github', url: peerReviewUrl } satisfies ImportSkillBody },
  skillOf('peer-review', true),
);
err(
  'POST /api/skills/import',
  'SKILL.md 头部缺 description',
  { body: { source: 'local', path: '~/skills/my-notes' } satisfies ImportSkillBody },
  'SKILL_INVALID',
  'SKILL.md 头部缺少 description',
);

ok<Skill>(
  'PUT /api/skills/{id}',
  '停用 pdf Skill',
  { params: { id: 'pdf' }, body: { enabled: false } satisfies UpdateSkillBody },
  { ...skills[0], enabled: false },
);
err(
  'PUT /api/skills/{id}',
  'Skill 不存在',
  { params: { id: 'missing-skill' }, body: { enabled: true } satisfies UpdateSkillBody },
  'NOT_FOUND',
  'Skill 不存在',
);

// ---- 设置与记忆
ok<Settings>('GET /api/settings', '设置（模型名为占位，模型选择待定 U2）', undefined, settings);
err('GET /api/settings', '读取失败', undefined, 'INTERNAL', '读取设置失败');
ok<Settings>(
  'PUT /api/settings',
  '默认开启联网检索',
  { body: { web_search_default: true } satisfies UpdateSettingsBody },
  { ...settings, web_search_default: true },
);
err(
  'PUT /api/settings',
  'api_base 不是合法 URL',
  { body: { api_base: 'not a url' } satisfies UpdateSettingsBody },
  'VALIDATION_ERROR',
  'api_base 必须是 http(s) 地址',
);

ok<MemoryItemList>(
  'GET /api/memory/items',
  '设置 → 记忆：当前有效条目',
  { query: { status: 'active' } },
  { items: memoryItems },
);
err(
  'GET /api/memory/items',
  'scope 取值不合法',
  { query: { scope: 'team' } },
  'VALIDATION_ERROR',
  'scope 只能是 global、project 或 branch',
);

ok<MemoryItem>(
  'PUT /api/memory/items/{id}',
  '修改一条记忆',
  {
    params: { id: 'mem_hw3_sigmoid' },
    body: { content: '作业 3 卡在 sigmoid 饱和导致梯度消失，已改用 ReLU 解决。' } satisfies UpdateMemoryItemBody,
  },
  { ...memoryItems[0], content: '作业 3 卡在 sigmoid 饱和导致梯度消失，已改用 ReLU 解决。' },
);
err(
  'PUT /api/memory/items/{id}',
  '条目不存在',
  { params: { id: 'mem_missing' }, body: { content: 'x' } satisfies UpdateMemoryItemBody },
  'NOT_FOUND',
  '记忆条目不存在',
);

ok<OkResult>(
  'DELETE /api/memory/items/{id}',
  '删除一条记忆（进入屏蔽列表）',
  { params: { id: 'mem_pref_conclusion' } },
  { ok: true },
);
err('DELETE /api/memory/items/{id}', '条目不存在', { params: { id: 'mem_missing' } }, 'NOT_FOUND', '记忆条目不存在');

ok<MemorySummary>('GET /api/memory/summary', '学习画像摘要', undefined, {
  content: '正在学习深度学习导论，近期重点是注意力机制与反向传播；偏好先给一句话结论再展开推导。',
  version: 3,
  updated_at: T.now,
});
err('GET /api/memory/summary', '读取失败', undefined, 'INTERNAL', '读取画像摘要失败');

export const FIXTURES: FixtureFile[] = files;
