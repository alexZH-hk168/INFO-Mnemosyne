// 规格：1-消息列表-用户消息（chat.user-message）
// 右对齐的浅灰气泡，显示用户原文与 @ 文件标签；长文本自动换行不溢出。乐观插入未确认时透明度 0.7，收到 message.start 后恢复。
// 不提供编辑（v1 不做）。
import { memo, type ReactNode } from 'react';
import type { ID } from '../api/types';

interface Props {
  id: ID;
  content: string;
  /** 项目里的文件名，用来把 `@文件名` 画成标签 */
  docTitles: string[];
  pending?: boolean;
}

function withMentions(text: string, titles: string[]): ReactNode[] {
  if (titles.length === 0) return [text];
  const esc = titles
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((t) => `@${t}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(esc.join('|'), 'g');
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    out.push(text.slice(last, i));
    out.push(
      <span key={i} data-mention="" className="rounded-chip bg-evi-bg px-1 text-evi-ink">
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function UserMessage({ id, content, docTitles, pending }: Props) {
  return (
    <div className="flex justify-end">
      <div
        data-testid={`chat.user-message:${id}`}
        data-pending={pending || undefined}
        className={`max-w-[82%] whitespace-pre-wrap break-words rounded-[16px] bg-panel-2 px-4 py-2.5 text-[14.5px] leading-[1.75] text-ink transition-opacity ${
          pending ? 'opacity-70' : ''
        }`}
      >
        {withMentions(content, docTitles)}
      </div>
    </div>
  );
}

export default memo(UserMessage);
