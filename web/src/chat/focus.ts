// 输入框聚焦请求（编排决定 U23：新建对话后输入框获得焦点）。
// 新建对话（goHome）时中间区可能已经是主页、输入框不会重新挂载，所以用一个窗口事件通知当前可见的输入框。
export const COMPOSER_FOCUS_EVENT = 'mn:focus-composer';

/** 请求聚焦输入框；variant 不填时任何主页/对话栏输入框都响应 */
export function requestComposerFocus(variant?: 'home' | 'chat' | 'branch'): void {
  if (typeof window === 'undefined') return;
  // 等本次渲染提交后再发，保证目标输入框已挂载
  requestAnimationFrame(() =>
    window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_EVENT, { detail: { variant: variant ?? null } })),
  );
}
