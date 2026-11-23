// 规格：1-输入框-演示模式提示（composer.demo-notice）——v0.5 [BYOK]
// 未配置模型（Settings.llm_mode = demo / demo_forced）时，在输入框下沿显示一行轻量提示，带“去设置”。
// 不假装是真实回答：明确写“回答由本地示例生成”。已配置真实模型时不渲染。
import { useDemoMode } from '../api/queries';
import { useUI } from '../store/ui';

export default function DemoModeNotice() {
  const { demo, forced } = useDemoMode();
  if (!demo) return null;
  return (
    <div
      data-testid="composer.demo-notice"
      data-forced={forced || undefined}
      role="note"
      className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-[12px] leading-[1.5] text-muted"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-faint" />
      <span className="min-w-0">
        <span className="text-ink-2">演示模式</span>
        {forced ? '：服务端只用本地示例回答（测试用）' : '：未配置模型，回答由本地示例生成'}
      </span>
      {!forced && (
        <button
          type="button"
          data-testid="composer.demo-notice.settings"
          onClick={() => useUI.getState().openModal('settings', { section: 'model' })}
          className="mn-focus flex-none rounded-btn-sm text-ink underline underline-offset-2 hover:text-ink-2"
        >
          去设置
        </button>
      )}
    </div>
  );
}
