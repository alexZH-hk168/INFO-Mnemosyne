// 步骤行摘要（规格 1-助手回答-步骤行「交互细则」）：
// 由前端统计——search_materials 去重文档数、search_web/fetch_url 网页数、recall_memory/open_source 计为“历史对话”。
// 用户要求不强调记忆：文案只说“参考 N 段历史对话”，不出现“记忆”二字。
// INT2（U110，编排决定）：N 按实际取到的历史对话证据（source_type=message）去重 source_id 计数，与后端步骤 label 同口径；
// 有历史对话步骤但 0 条证据时写“没有找到相关的历史对话”。历史消息只能读到被引用的证据（evidenceComplete=false），
// 这时 0 条不能断定没找到：步骤 label 全是“没有找到相关的历史对话”才这样写，否则写不带数字的“参考历史对话”。
import type { Evidence, Step, StepKind } from '../api/types';

export interface StepSummary {
  /** “检索 2 份材料、1 个网页，参考 1 段历史对话” */
  text: string;
  /** 步数（同一 step_id 只算一次） */
  count: number;
  /** 整轮耗时（秒，四舍五入，至少 1）；不知道整轮耗时为 0，不显示。编排决定 U35：不再用各步 duration_ms 之和 */
  seconds: number;
  /** 正在进行的步骤 */
  running: Step | null;
  /** 失败的步骤数 */
  failed: number;
}

const HISTORY_KINDS: StepKind[] = ['recall_memory', 'open_source'];
export const HISTORY_NONE = '没有找到相关的历史对话';
const WEB_KINDS: StepKind[] = ['search_web', 'fetch_url'];

/** 每种步骤在明细里的类别名（不出现“记忆”） */
export const STEP_KIND_NAME: Record<StepKind, string> = {
  search_materials: '检索材料',
  search_web: '联网检索',
  fetch_url: '抓取网页',
  recall_memory: '历史对话',
  open_source: '打开原文',
  plugin_tool: '插件',
  load_skill: 'Skill',
};

export function summarizeSteps(
  steps: Step[],
  evidence: Pick<Evidence, 'source_type' | 'source_id'>[] = [],
  /** 整轮耗时（毫秒），来源见 lib/latency.ts */
  latencyMs?: number,
  /** evidence 是否为本轮全部证据（流式证据池为 true；历史消息只有被引用的证据或仍在加载时为 false） */
  evidenceComplete = true,
): StepSummary {
  const materialDocs = new Set(evidence.filter((e) => e.source_type === 'material').map((e) => e.source_id));
  const webPages = new Set(evidence.filter((e) => e.source_type === 'web').map((e) => e.source_id));
  const searchedMaterials = steps.some((s) => s.kind === 'search_materials');
  const webSteps = steps.filter((s) => WEB_KINDS.includes(s.kind) && s.status !== 'error').length;
  const historySteps = steps.filter((s) => HISTORY_KINDS.includes(s.kind));
  const historyCount = new Set(evidence.filter((e) => e.source_type === 'message').map((e) => e.source_id)).size;

  // 网页数：优先按证据去重；没有证据（如历史消息未加载证据）时按抓取/检索步骤数
  const webCount = webPages.size > 0 ? webPages.size : webSteps;
  const retrieval: string[] = [];
  if (searchedMaterials && materialDocs.size > 0) retrieval.push(`${materialDocs.size} 份材料`);
  if (webCount > 0) retrieval.push(`${webCount} 个网页`);

  const parts: string[] = [];
  if (retrieval.length > 0) parts.push(`检索 ${retrieval.join('、')}`);
  else if (searchedMaterials) parts.push('检索项目材料');
  if (historySteps.length > 0) {
    if (historyCount > 0) parts.push(`参考 ${historyCount} 段历史对话`);
    else if (evidenceComplete || historySteps.every((s) => s.label === HISTORY_NONE)) parts.push(HISTORY_NONE);
    else parts.push('参考历史对话');
  }

  const running = [...steps].reverse().find((s) => s.status === 'running') ?? null;
  const text = parts.length > 0 ? parts.join('，') : (steps[steps.length - 1]?.label ?? '');
  return {
    text,
    count: steps.length,
    seconds: latencyMs !== undefined && latencyMs >= 0 ? Math.max(1, Math.round(latencyMs / 1000)) : 0,
    running,
    failed: steps.filter((s) => s.status === 'error').length,
  };
}
