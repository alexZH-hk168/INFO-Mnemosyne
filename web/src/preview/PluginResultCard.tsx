// 规格：2-证据胶囊-插件结果卡片（right.plugin-card）
// 没有 URL 的插件结果（如 Zotero 条目）在右栏以只读字段表显示：插件名、工具名、字段键值；字段值超长折叠。
// 入口：证据胶囊（plugin），tab kind=plugin，locator={plugin_id, tool_name, fields}。接口：['evidence', eid]。
// 注：规格里程碑写的是 F6，F4 提示词把它列进右栏任务，这里一并实现（见 PROGRESS 动作日志）。
import { useState } from 'react';
import { usePlugins } from '../api/queries';
import type { Evidence } from '../api/types';
import { PuzzleIcon } from '../icons/Icons';
import type { Tab } from '../store/layout';
import { useTabEvidence } from './useEvidenceContext';

export const FOLD_AT = 240;

function show(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, null, 2);
}

function FieldValue({ k, value }: { k: string; value: string }) {
  const [open, setOpen] = useState(false);
  const long = Array.from(value).length > FOLD_AT;
  const text = long && !open ? `${Array.from(value).slice(0, FOLD_AT).join('')}…` : value;
  return (
    <dd className="min-w-0 whitespace-pre-wrap break-words text-ink-2">
      <span data-testid={`right.plugin-card.value:${k}`}>{text}</span>
      {long && (
        <button
          type="button"
          data-testid={`right.plugin-card.toggle:${k}`}
          aria-expanded={open}
          onClick={() => setOpen((x) => !x)}
          className="mn-focus ml-1 rounded-btn-sm px-1 text-[12px] text-evi-web-ink hover:bg-panel"
        >
          {open ? '收起' : '展开'}
        </button>
      )}
    </dd>
  );
}

export function PluginCardBody({ evidence, pluginName }: { evidence: Evidence; pluginName?: string }) {
  const loc = evidence.locator as { plugin_id?: string; tool_name?: string; fields?: Record<string, unknown> };
  const fields = Object.entries(loc.fields ?? {});
  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center gap-2">
        <PuzzleIcon size={15} className="text-evi-web-ink" />
        <span data-testid="right.plugin-card.plugin" className="text-[13px] font-medium text-ink">
          {pluginName ?? loc.plugin_id}
        </span>
        <span
          data-testid="right.plugin-card.tool"
          className="rounded-chip bg-[var(--code-bg)] px-1.5 font-mono text-[11.5px] text-[var(--tool-ink)]"
        >
          {loc.tool_name}
        </span>
      </div>
      <dl className="grid grid-cols-[minmax(80px,auto)_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        {fields.map(([k, v]) => (
          <div key={k} data-testid={`right.plugin-card.field:${k}`} className="contents">
            <dt className="font-mono text-[12px] text-muted">{k}</dt>
            <FieldValue k={k} value={show(v)} />
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function PluginResultCard({ tab }: { tab: Tab }) {
  const ev = useTabEvidence(tab);
  const plugins = usePlugins();
  const pid = (ev?.locator as { plugin_id?: string } | undefined)?.plugin_id;
  const name = plugins.data?.plugins.find((p) => p.id === pid)?.name;
  return (
    <div data-testid="right.plugin-card" className="h-full min-h-0 overflow-auto bg-surface">
      {ev ? (
        <PluginCardBody evidence={ev} pluginName={name} />
      ) : (
        <div className="py-8 text-center text-[13px] text-muted">从回答里的插件证据打开时显示原始字段</div>
      )}
    </div>
  );
}
