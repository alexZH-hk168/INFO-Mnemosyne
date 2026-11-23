// 规格：1-输入框-插件区入口（composer.plugin-entry）、2-插件区-会话插件弹层（plugins.popover）共用的数据整理。
// 读 ['plugins']（已安装）、['convPlugins', cid]（本对话开关）、['market','plugins']（类别、简称兜底、色块序号）；
// 主页（无 cid）读已安装插件的默认启用状态，用户在弹层里改过的列表暂存在主页草稿 composer['new:main'].enabled_plugin_ids。
// “本轮调用 N 次”由当前回答的 step 统计（规格交互细则）：步骤带 plugin_id（契约 v0.5 并行草案，原 U60）就按它匹配，没有才按 label 匹配。
import { useMemo } from 'react';
import { useConvPlugins, useMarket, usePlugins, useTree } from '../../api/queries';
import type { ConversationPlugin, ID, InstalledPlugin, MarketItem, Step } from '../../api/types';
import { NEW_MAIN, useChat } from '../../store/chat';

export interface PluginRow {
  id: ID;
  name: string;
  /** 胶囊里用的简称：short_name，缺省退回 name（编排决定，原 U36） */
  short: string;
  category?: string;
  /** 市场 registry 里的序号（决定色块颜色）；不在 registry 时 -1 */
  index: number;
  /** 界面上的开关状态：可用且已启用 */
  enabled: boolean;
  /** status=installed 且必填配置齐全 */
  usable: boolean;
  /** 不可用的原因（status=error 的 reason、缺配置等） */
  reason?: string;
  /** 副标题：类别 · 本轮调用 N 次 / 不可用原因 / 需要 API Key（已配置） */
  sub: string;
  calls: number;
}

/** 简称：short_name → name */
export function shortName(p: { name: string; short_name?: string }): string {
  return p.short_name?.trim() || p.name;
}

/** 一个 plugin_tool 步骤是不是某插件发起的：label 以 `${id}__` 开头（label 为空时后端退回 tool_name），或含插件简称 / 全名 */
export function stepMatchesPlugin(label: string, p: { id: ID; name: string; short_name?: string }): boolean {
  const l = label.toLowerCase();
  if (l.startsWith(`${p.id.toLowerCase()}__`)) return true;
  return [p.short_name, p.name].some((n) => !!n && l.includes(n.toLowerCase()));
}

export function countCalls(steps: Step[], p: { id: ID; name: string; short_name?: string }): number {
  const seen = new Set<ID>();
  for (const s of steps) {
    if (s.kind !== 'plugin_tool') continue;
    const hit = s.plugin_id ? s.plugin_id === p.id : stepMatchesPlugin(s.label, p);
    if (hit) seen.add(s.step_id);
  }
  return seen.size;
}

/** 缺少的必填配置项（取 config_schema 里 required 且不在 config_set 的第一项） */
function missingConfig(p: InstalledPlugin): { key: string; label: string; secret: boolean } | null {
  const set = new Set(p.config_set ?? []);
  for (const [key, f] of Object.entries(p.config_schema ?? {})) {
    if (f.required && !set.has(key)) return { key, label: f.label, secret: f.secret };
  }
  return null;
}

/** 密钥类配置的叫法：“Tavily API Key” → “API Key” */
function keyWord(label: string): string {
  return /api\s*key/i.test(label) ? 'API Key' : label;
}

const STATUS_REASON: Partial<Record<InstalledPlugin['status'], string>> = {
  error: '插件自检失败',
  disabled: '插件已停用',
};

export function buildRow(
  p: InstalledPlugin,
  conv: ConversationPlugin | undefined,
  enabledFlag: boolean,
  market: MarketItem | undefined,
  index: number,
  steps: Step[],
): PluginRow {
  const status = conv?.status ?? p.status;
  const short = shortName({ name: p.name, short_name: p.short_name ?? market?.short_name });
  const miss = missingConfig(p);
  let reason: string | undefined;
  if (status !== 'installed') reason = conv?.reason ?? STATUS_REASON[status] ?? '插件不可用';
  else if (miss)
    reason = conv?.reason ?? (miss.secret ? `需要 ${keyWord(miss.label)}（未配置）` : `缺少配置：${miss.label}`);
  const usable = !reason;
  const calls = countCalls(steps, { id: p.id, name: p.name, short_name: short });
  const parts: string[] = [];
  if (market?.category) parts.push(market.category);
  if (reason) parts.push(reason);
  else {
    if (calls > 0) parts.push(`本轮调用 ${calls} 次`);
    const secret = Object.values(p.config_schema ?? {}).find((f) => f.required && f.secret);
    if (secret) parts.push(`需要 ${keyWord(secret.label)}（已配置）`);
  }
  const row: PluginRow = {
    id: p.id,
    name: p.name,
    short,
    index,
    enabled: usable && enabledFlag,
    usable,
    sub: parts.join(' · '),
    calls,
  };
  if (market?.category) row.category = market.category;
  if (reason) row.reason = reason;
  return row;
}

const NO_STEPS: Step[] = [];

/** 当前回答的步骤：本对话正在流式/刚结束的一轮优先，否则取树上 active_leaf 那条助手回答 */
export function useAnswerSteps(cid: ID | null | undefined): Step[] {
  const tree = useTree(cid);
  const live = useChat((s) =>
    cid && s.turn && s.turn.conversation_id === cid && s.streaming ? s.streaming.steps : null,
  );
  return useMemo(() => {
    if (live) return live;
    const data = tree.data;
    if (!cid || !data) return NO_STEPS;
    const leafId = data.active_leaf_id ?? data.conversation.active_leaf_id;
    const leaf = data.messages.find((m) => m.id === leafId);
    return leaf?.role === 'assistant' ? (leaf.steps ?? NO_STEPS) : NO_STEPS;
  }, [live, tree.data, cid]);
}

export interface PluginRowsResult {
  rows: PluginRow[];
  /** 已拿到足够数据（已安装列表；有 cid 时还有本对话开关） */
  ready: boolean;
}

/** 弹层与胶囊共用：本对话（或主页）的插件行 */
export function usePluginRows(cid: ID | null | undefined): PluginRowsResult {
  const installed = usePlugins();
  const conv = useConvPlugins(cid);
  const market = useMarket('plugins');
  const homeIds = useChat((s) => (cid ? undefined : s.composer[NEW_MAIN]?.enabled_plugin_ids));
  const steps = useAnswerSteps(cid);
  return useMemo(() => {
    const plugins = installed.data?.plugins ?? [];
    const items = market.data?.items ?? [];
    const byMarket = new Map(items.map((m, i) => [m.id, { m, i }]));
    const ready = !!installed.data && (!cid || !!conv.data);
    if (!ready) return { rows: [], ready };
    const convRows = new Map((conv.data?.plugins ?? []).map((c) => [c.plugin_id, c]));
    // 有 cid：按会话接口的顺序列已安装插件（接口只列已安装）；主页：已安装列表
    const ordered = cid
      ? (conv.data?.plugins ?? [])
          .map((c) => plugins.find((p) => p.id === c.plugin_id))
          .filter((p): p is InstalledPlugin => !!p)
      : plugins;
    const rows = ordered.map((p) => {
      const c = convRows.get(p.id);
      const flag = cid ? !!c?.enabled : homeIds ? homeIds.includes(p.id) : true;
      const hit = byMarket.get(p.id);
      return buildRow(p, c, flag, hit?.m, hit?.i ?? -1, cid ? steps : NO_STEPS);
    });
    return { rows, ready };
  }, [installed.data, conv.data, market.data, homeIds, steps, cid]);
}
