// 规格：1-外壳-全局提示（shell.toast）
// 右下角提示队列：info/success 4 s 后自动消失；error 不自动消失、带关闭按钮；同时多于 3 条只显示最新 3 条。
// 顶部连接状态条：后端不可达时显示“无法连接后端”。
import { useEffect } from 'react';
import { CloseIcon } from '../icons/Icons';
import { useUI, type Toast } from '../store/ui';

export const TOAST_AUTO_MS = 4000;
const MAX_VISIBLE = 3;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUI((s) => s.dismissToast);
  useEffect(() => {
    if (toast.kind === 'error') return;
    const t = window.setTimeout(() => dismiss(toast.id), TOAST_AUTO_MS);
    return () => window.clearTimeout(t);
  }, [toast.id, toast.kind, dismiss]);

  const isError = toast.kind === 'error';
  return (
    <div
      data-testid={`shell.toast:${toast.id}`}
      data-kind={toast.kind}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className="pointer-events-auto flex max-w-[360px] items-start gap-2.5 rounded-card-sm border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink shadow-lg"
    >
      <span
        aria-hidden="true"
        className={`mt-[7px] h-1.5 w-1.5 flex-none rounded-pill ${
          isError ? 'bg-danger' : toast.kind === 'success' ? 'bg-ok' : 'bg-muted'
        }`}
      />
      <span className="min-w-0 flex-1 leading-[1.55]">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          data-testid={`shell.toast.action:${toast.id}`}
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
          className="mn-focus flex-none rounded-btn-sm px-1.5 font-medium text-ink underline-offset-2 hover:underline"
        >
          {toast.action.label}
        </button>
      )}
      {isError && (
        <button
          type="button"
          data-testid={`shell.toast.dismiss:${toast.id}`}
          aria-label="关闭提示"
          onClick={() => dismiss(toast.id)}
          className="mn-iconbtn -my-1 -mr-1.5 h-6 w-6"
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}

export default function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const visible = toasts.slice(-MAX_VISIBLE);
  return (
    <div
      data-testid="shell.toast"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
    >
      {visible.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

/** 顶部连接状态条（后端不可达）；重连由 FourPane 定时重试，条上不放规格没写的按钮 */
export function ConnectionBar() {
  return (
    <div
      data-testid="shell.toast:offline"
      role="alert"
      className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-pill border border-line bg-surface px-4 py-1.5 text-[12.5px] text-ink shadow-lg"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-pill bg-danger" />
      无法连接后端
    </div>
  );
}
