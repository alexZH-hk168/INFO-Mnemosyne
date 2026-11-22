// 规格：3-插件详情-工具列表（market.plugin-tools）
// “提供的工具”表：工具名（等宽）＋中文说明；默认列 8 个，其余折叠为“还有 … 等 N 个”。不在 tools_allow 的行尾灰字“未启用”。
// 说明文字来自接口（registry 里的中文翻译），前端不写死。
import { useState } from 'react';
import type { PluginDetail } from '../api/types';
import { ChevronDown } from './icons';

export const VISIBLE_TOOLS = 8;
/** 折叠行里点名的工具数 */
const NAMED_IN_MORE = 4;

export interface ToolTableProps {
  tools: PluginDetail['tools'];
  /** `PluginDetail.manifest.tools_allow`（契约 v0.3）；省略＝全部开放，不标“未启用” */
  allow?: readonly string[];
}

export default function ToolTable({ tools, allow }: ToolTableProps) {
  const [expanded, setExpanded] = useState(false);
  const hidden = tools.slice(VISIBLE_TOOLS);
  const rows = expanded ? tools : tools.slice(0, VISIBLE_TOOLS);
  return (
    <div data-testid="market.plugin-tools" className="overflow-hidden rounded-card border border-line">
      {rows.map((t) => {
        const off = allow !== undefined && !allow.includes(t.name);
        return (
          <div
            key={t.name}
            data-testid={`market.plugin-tools.row:${t.name}`}
            className="flex items-baseline border-t border-line-2 px-3.5 py-2 text-[12.5px] first:border-t-0"
          >
            <code className="w-[200px] flex-none font-mono text-[12px] text-[var(--tool-ink)]">{t.name}</code>
            <span className="min-w-0 flex-1 text-ink-2">{t.description}</span>
            {off && (
              <span
                data-testid={`market.plugin-tools.off:${t.name}`}
                className="ml-3 flex-none text-[11.5px] text-faint"
              >
                未启用
              </span>
            )}
          </div>
        );
      })}
      {hidden.length > 0 && (
        <button
          type="button"
          data-testid="market.plugin-tools.more"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="mn-focus flex w-full items-center gap-1 border-t border-line-2 px-3.5 py-2 text-left text-[12px] text-muted hover:bg-canvas"
        >
          {expanded
            ? '收起'
            : `还有 ${hidden
                .slice(0, NAMED_IN_MORE)
                .map((t) => t.name)
                .join('、')}${hidden.length > NAMED_IN_MORE ? ' ' : ''}等 ${hidden.length} 个`}
          <span className={expanded ? 'rotate-180' : ''}>
            <ChevronDown />
          </span>
        </button>
      )}
    </div>
  );
}
