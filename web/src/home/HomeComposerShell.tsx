// 规格：1-外壳-输入框（composer.box）的主页版外观（variant="home"）。
// F2 只做外观与聚焦；发送、联网开关、引用范围、插件、附件、模型档位的交互由 F3 的正式输入框实现并替换本组件。
// 文本绑定 useChat.composer['main'].text，这样“试一试”预填的示例问题能显示出来。
import { forwardRef } from 'react';
import { MAIN, useChat } from '../store/chat';
import { setMainDraftText } from './draft';
import { Icon } from './icons';

/** 占位文案按规格 1-外壳-输入框「状态」表（主页）；UI-01 概念图文案不同，见 PROGRESS 未决（F2-1） */
const PLACEHOLDER = '问点什么，或拖入论文、课件、代码';

export const HomeComposerShell = forwardRef<HTMLTextAreaElement>(function HomeComposerShell(_props, ref) {
  const text = useChat((s) => s.composer[MAIN]?.text ?? '');
  const hasText = text.trim().length > 0;

  return (
    <div
      data-testid="composer.box"
      data-variant="home"
      className="rounded-[18px] border border-line bg-panel-2 p-[5px]"
    >
      <div className="flex h-[34px] items-center gap-5 px-3 text-[13px] text-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="globe" size={15} />
          联网检索
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="layers" size={15} />
          引用范围：全部材料
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Icon name="puzzle" size={15} />
          插件
        </span>
      </div>
      <div className="rounded-[13px] border border-line bg-surface px-4 pb-2.5 pt-3.5 transition-colors focus-within:border-faint">
        <textarea
          ref={ref}
          // 规格 1-新建对话-主页「验收」：输入框自动获得焦点
          autoFocus
          rows={2}
          value={text}
          onChange={(e) => setMainDraftText(e.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="输入问题"
          className="block h-[46px] w-full resize-none bg-transparent text-[15px] leading-[23px] text-ink outline-none placeholder:text-faint"
        />
        <div className="mt-1.5 flex items-center gap-3 text-[13px] text-ink-2">
          <span className="grid h-7 w-7 place-items-center text-muted" aria-hidden="true">
            <Icon name="plus" size={17} />
          </span>
          <span
            className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-line px-2.5 text-ink-2"
            aria-hidden="true"
          >
            <Icon name="puzzle" size={14} />
            插件
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted" aria-hidden="true">
            <Icon name="sparkle" size={14} />
            模型 · 高
          </span>
          {/* 发送逻辑在 F3；外壳阶段始终禁用，只按是否有文字切换颜色 */}
          <button
            type="button"
            data-testid="composer.send"
            aria-label="发送"
            disabled
            className={`ml-auto grid h-[34px] w-[34px] place-items-center rounded-pill text-surface ${hasText ? 'bg-ink' : 'bg-faint'}`}
          >
            <Icon name="arrow-up" size={17} />
          </button>
        </div>
      </div>
    </div>
  );
});
