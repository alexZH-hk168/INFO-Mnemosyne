// 规格：1-助手回答-推断标记（chat.inference-mark）
// verdict=partial 的句子（取消回合里未校验的引用也以 partial 发出）句末加灰色小字“推断”，悬停说明“没有找到直接支持这句话的原文”。
// 不改变句子正文颜色。模型自行标注“推断句”的写法立项稿未定义（规格「待确认」），B2 定后再接。
import type { ID } from '../api/types';

export const INFERENCE_TIP = '没有找到直接支持这句话的原文';

export default function InferenceMark({ messageId, citationId }: { messageId: ID; citationId: ID }) {
  return (
    <span
      data-testid={`chat.inference-mark:${messageId}:${citationId}`}
      tabIndex={0}
      title={INFERENCE_TIP}
      aria-label={`推断：${INFERENCE_TIP}`}
      className="mn-focus relative top-[-1px] ml-1 inline-block cursor-help select-none rounded-chip align-middle text-[11px] leading-none text-faint"
    >
      推断
    </span>
  );
}
