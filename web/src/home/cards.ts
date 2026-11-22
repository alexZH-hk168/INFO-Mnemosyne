// 规格：2-能力卡片-卡片介绍弹窗（home.card-modal）「交互细则」——文案写死在 home/cards.ts，三张卡一个数组，
// 标题与说明从 UI-02～04 原样抄。封面插画里的示意文字也放在这里，组件里不写死演示文字（AGENTS.md R4）。

export type CardId = 'paper' | 'code' | 'slides';

/** 富文本片段：sub/sup 为上下标，hl 为原文高亮 */
export interface Seg {
  t: string;
  sub?: boolean;
  sup?: boolean;
  hl?: boolean;
}
export type Rich = Seg[];

/** 逐字书写富文本的小工具：'d_k' 写成 [t('d'), sub('k')] */
export const t = (s: string, hl = false): Seg => (hl ? { t: s, hl } : { t: s });
export const sub = (s: string, hl = false): Seg => (hl ? { t: s, sub: true, hl } : { t: s, sub: true });
export const sup = (s: string): Seg => ({ t: s, sup: true });

export interface CoverNote {
  title: Rich;
  body: string;
  /** 证据胶囊：material=材料（黄），web=网页/插件（蓝） */
  chip: { label: string; tone: 'material' | 'web' };
}

export interface PaperCover {
  kind: 'paper';
  title: string;
  authors: string;
  section: string;
  intro: Rich[];
  formula: Rich;
  /** 正文逐行；带 hl 的片段在封面动画里被高亮条从左向右扫过 */
  body: Rich[];
  ops: { label: string; tone: 'op' | 'mask' }[];
  note: CoverNote;
}

export type CodeTok = { k: 'kw' | 'fn' | 'str' | 'plain'; t: string };
export interface CodeCover {
  kind: 'code';
  file: string;
  badge: string;
  readonly: string;
  crumbs: string[];
  lines: CodeTok[][];
  /** 静态时停留的高亮行（从 1 起） */
  focusLine: number;
  /** 循环动画逐行扫过的起始行（从 1 起），扫到 focusLine 停住 */
  scanFrom: number;
  note: CoverNote;
}

export interface SlideCover {
  kind: 'slides';
  deck: string;
  page: string;
  title: string;
  /** 计算图节点标签：x, w, ×, b, +, σ, L */
  nodes: { x: string; w: string; mul: string; b: string; add: string; sig: string; loss: string };
  /** 反向梯度标签：L→σ, σ→+, +→×, ×→w */
  grads: { la: string; az: string; zu: string; uw: string };
  formula: string;
  quiz: { meta: string; question: string; options: string[]; correct: number };
}

export interface CardDef {
  id: CardId;
  /** 卡面标题，也用于 aria-label“了解{title}” */
  title: string;
  headline: string[];
  description: string;
  rows: { title: string; desc: string }[];
  source: string;
  /** 弹窗预览左下角浮签 */
  overlay: { icon: 'branch' | 'book' | 'history'; label: string; text: Rich };
  /**
   * “试一试”预填到主页输入框的示例问题。
   * TODO(U8)：示例材料（论文/代码/课件各用哪份）待用户拍板；定了以后补 web/public/samples/<card>/ 并上传，
   * 示例问题也可能随材料调整。现在只预填问题、不上传文件。问题取自 UI-01～04 封面里的提问。
   */
  sampleQuestion: string;
  cover: PaperCover | CodeCover | SlideCover;
}

export const BRAND = 'Mnemosyne';

export const CARDS: CardDef[] = [
  {
    id: 'paper',
    title: '论文阅读',
    headline: ['读论文，讲解有据可查，', '一点回到原文。'],
    description:
      '上传 PDF 后自动解析文字和它在页面上的位置。讲解先说这一段在论证什么，再拆方法；有依据的结论带证据胶囊，点开直接定位到原句所在的页。',
    rows: [
      { title: '逐段精读', desc: '按章节讲清论证、方法和图表含义，术语用到时再解释。' },
      { title: '划词开分支', desc: '选中任意一句追问，分支对话在右栏展开，主线不被打断。' },
      { title: '证据追踪', desc: '回答标出 PDF 页码与原句、网页链接；找不到依据时直接说明。' },
    ],
    source: '示例：Vaswani et al., Attention Is All You Need, NeurIPS 2017, §3.2.1。页面为示意排版，非原 PDF 截图。',
    overlay: { icon: 'branch', label: '分支', text: [t('方差为什么正好是 d'), sub('k'), t('？')] },
    sampleQuestion: '为什么 Scaled Dot-Product Attention 要除以 √d_k？',
    cover: {
      kind: 'paper',
      title: 'Attention Is All You Need',
      authors: 'Vaswani, Shazeer, Parmar, et al. · NeurIPS 2017',
      section: '3.2.1  Scaled Dot-Product Attention',
      intro: [
        [t('We call our particular attention "Scaled Dot-Product Attention". The input')],
        [
          t('consists of queries and keys of dimension d'),
          sub('k'),
          t(', and values of dimension d'),
          sub('v'),
          t('.'),
        ],
      ],
      formula: [t('Attention(Q, K, V) = softmax(QK'), sup('T'), t(' / √d'), sub('k'), t(')V')],
      body: [
        [t('We suspect that for large values of d', true), sub('k', true), t(', the dot products grow large in', true)],
        [t('magnitude, pushing the softmax function into regions where it has', true)],
        [t('extremely small gradients.', true), t(' To counteract this effect, we scale the dot')],
        [t('products by 1/√d'), sub('k'), t('.')],
      ],
      ops: [
        { label: 'MatMul', tone: 'op' },
        { label: 'Scale', tone: 'op' },
        { label: 'Mask', tone: 'mask' },
        { label: 'SoftMax', tone: 'op' },
        { label: 'MatMul', tone: 'op' },
      ],
      note: {
        title: [t('为什么要除以 √d'), sub('k'), t('？')],
        body: '维度越大，点积的方差越大，softmax 会被推到梯度几乎为 0 的区域',
        chip: { label: '1 · p.4', tone: 'material' },
      },
    },
  },
  {
    id: 'code',
    title: '代码解析',
    headline: ['看懂一份代码，', '从调用链开始。'],
    description:
      '导入仓库或单个文件后，先理出从入口到核心函数的调用链，再逐行解释关键实现。只做只读预览和讲解，不改你的代码。',
    rows: [
      { title: '调用链梳理', desc: '从 train.py 出发找到核心函数，标出张量形状在每一步怎么变。' },
      { title: '逐行讲解', desc: '选中一行就能问，解释引用官方文档或论文里对应的公式。' },
      { title: '对照论文与课件', desc: '把代码和论文公式、课件页并排对上，指出实现与原文的差异。' },
    ],
    source: '示例代码为教学用注意力实现；文档来源：PyTorch 官方文档（scaled_dot_product_attention）。',
    overlay: { icon: 'book', label: '对照', text: [t('论文 Eq.(1) · 课件第 5 讲 p.18')] },
    sampleQuestion: '第 7 行为什么填 -inf 而不是 0？',
    cover: {
      kind: 'code',
      file: 'transformer.py',
      badge: 'PY',
      readonly: '只读预览',
      crumbs: ['train.py', 'Encoder.forward', 'MultiHeadAttention', 'scaled_dot_product_attention'],
      lines: [
        [
          { k: 'kw', t: 'import' },
          { k: 'plain', t: ' math' },
        ],
        [],
        [
          { k: 'kw', t: 'def' },
          { k: 'plain', t: ' ' },
          { k: 'fn', t: 'scaled_dot_product_attention' },
          { k: 'plain', t: '(q, k, v, mask=' },
          { k: 'kw', t: 'None' },
          { k: 'plain', t: '):' },
        ],
        [{ k: 'plain', t: '    d_k = q.size(-1)' }],
        [{ k: 'plain', t: '    scores = q @ k.transpose(-2, -1) / math.sqrt(d_k)' }],
        [
          { k: 'plain', t: '    ' },
          { k: 'kw', t: 'if' },
          { k: 'plain', t: ' mask ' },
          { k: 'kw', t: 'is not None' },
          { k: 'plain', t: ':' },
        ],
        [
          { k: 'plain', t: '        scores = scores.masked_fill(mask == 0, ' },
          { k: 'str', t: 'float("-inf")' },
          { k: 'plain', t: ')' },
        ],
        [{ k: 'plain', t: '    attn = scores.softmax(dim=-1)' }],
        [
          { k: 'plain', t: '    ' },
          { k: 'kw', t: 'return' },
          { k: 'plain', t: ' attn @ v, attn' },
        ],
      ],
      focusLine: 7,
      scanFrom: 3,
      note: {
        title: [t('第 7 行：为什么填 -inf 而不是 0？')],
        body: '填 0 之后 softmax 仍会给这个位置分到权重；填 -inf，exp 后正好是 0，被遮住的词不参与加权',
        chip: { label: 'PyTorch 文档', tone: 'web' },
      },
    },
  },
  {
    id: 'slides',
    title: '课件学习',
    headline: ['一学期的课件，', '按知识点帮你记住。'],
    description:
      '课件按知识点切分并建索引。学过什么、在哪里卡过会接着上次往下讲，复习时先补薄弱处；每道题的答案都标出课件页码。',
    rows: [
      { title: '知识点地图', desc: '把 PPT / PDF 拆成知识点，标出先修关系和你的掌握程度。' },
      { title: '接着上次学', desc: '上周作业里混淆过的概念，下次讲到相关内容时会拿出来对比。' },
      { title: '复习与小测', desc: '按遗忘间隔生成练习，答案附课件出处，可直接追问。' },
    ],
    source: '示例课件为示意内容，非真实课程材料。',
    overlay: { icon: 'history', label: '上次 · 作业 3', text: [t('把 σ′(z) 的最大值写成了 0.5')] },
    sampleQuestion: 'σ′(z) 的最大值是多少？为什么？',
    cover: {
      kind: 'slides',
      deck: '深度学习导论 · 第 5 讲',
      page: '14 / 32',
      title: '反向传播：链式法则在计算图上的展开',
      nodes: { x: 'x', w: 'w', mul: '×', b: 'b', add: '+', sig: 'σ', loss: 'L' },
      grads: { la: '∂L/∂a', az: '∂a/∂z', zu: '∂z/∂u', uw: '∂u/∂w' },
      formula: '∂L/∂w = ∂L/∂a · ∂a/∂z · ∂z/∂u · ∂u/∂w',
      quiz: {
        meta: '小测 2 / 5 · 第 5 讲',
        question: 'σ′(z) 的最大值是多少？',
        options: ['1', '0.25', '0.5'],
        correct: 1,
      },
    },
  },
];

export const CARD_IDS: CardId[] = CARDS.map((c) => c.id);

export function getCard(id: CardId): CardDef {
  const c = CARDS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
}

export function isCardId(v: unknown): v is CardId {
  return typeof v === 'string' && (CARD_IDS as string[]).includes(v);
}

/** 循环取相邻卡片：dir=1 下一张，-1 上一张 */
export function neighborCard(id: CardId, dir: 1 | -1): CardId {
  const i = CARD_IDS.indexOf(id);
  return CARD_IDS[(i + dir + CARD_IDS.length) % CARD_IDS.length];
}
