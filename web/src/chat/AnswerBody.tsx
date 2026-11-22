// 回答正文：Markdown（react-markdown + remark-math + rehype-katex）＋ 证据胶囊 ＋ “推断”标记。
// `[[E#]]` 与 partial 句末位置先换成占位字符（lib/answerMarkup），再由 rehype 插件变成 span，映射到 EvidenceChip / InferenceMark。
// 句子与锚点偏移按“去掉 [[E#]] 后的纯文本”计算（契约），F5 划词用 data-message-id 定位到这里。
import 'katex/dist/katex.min.css';
import { memo, useMemo, useRef, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import type { Citation, ID } from '../api/types';
import { trimPartialMarker } from '../lib/citations';
import { buildAnswerMarkup, rehypeAnswerSlots } from '../lib/answerMarkup';
import EvidenceChip from './EvidenceChip';
import InferenceMark from './InferenceMark';

interface Props {
  messageId: ID;
  content: string;
  citations: Citation[];
  streaming: boolean;
}

function AnswerBody({ messageId, content, citations, streaming }: Props) {
  const raw = streaming ? trimPartialMarker(content) : content;
  const markup = useMemo(() => buildAnswerMarkup(raw, citations), [raw, citations]);
  // 组件映射保持稳定（否则每段 delta 都会重新挂载全部胶囊），渲染时从 ref 读最新的占位表
  const slots = useRef(markup);
  slots.current = markup;

  const components = useMemo(
    () => ({
      span: ({ node: _node, ...props }: ComponentProps<'span'> & { node?: unknown }) => {
        const p = props as Record<string, unknown>;
        const chip = p['data-mn-chip'];
        if (chip !== undefined) {
          const slot = slots.current.chips[Number(chip)];
          if (!slot) return null;
          return (
            <EvidenceChip
              messageId={messageId}
              label={slot.label}
              eid={slot.citation?.eid}
              verdict={slot.citation?.verdict}
            />
          );
        }
        const inf = p['data-mn-inf'];
        if (inf !== undefined) {
          const slot = slots.current.inferences[Number(inf)];
          return slot ? <InferenceMark messageId={messageId} citationId={slot.citation.citation_id} /> : null;
        }
        return <span {...props} />;
      },
      a: ({ node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) => (
        <a
          {...props}
          target="_blank"
          rel="noreferrer noopener"
          className="text-evi-web-ink underline underline-offset-2"
        />
      ),
    }),
    [messageId],
  );

  return (
    <div
      data-testid={`chat.answer-body:${messageId}`}
      data-message-id={messageId}
      data-streaming={streaming || undefined}
      className="mn-answer"
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeAnswerSlots]}
        components={components}
      >
        {markup.source}
      </ReactMarkdown>
      {streaming && <span aria-hidden="true" className="mn-caret" />}
    </div>
  );
}

export default memo(AnswerBody);
