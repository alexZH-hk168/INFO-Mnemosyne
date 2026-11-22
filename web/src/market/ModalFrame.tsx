// F6 弹窗外壳：遮罩、居中、锁焦点、Esc 关闭、关闭后焦点回到触发元素（docs/DEVELOPMENT.md「可访问性」）。
// 安装确认弹窗、导入 Skill、卸载确认、设置弹窗、删除记忆确认共用。
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalFrameProps {
  testid: string;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** 弹窗宽度 px */
  width?: number;
  /** 打开时聚焦的元素选择器；默认第一个可聚焦元素 */
  initialFocus?: string;
  /** 有内层弹窗时外层不响应 Esc */
  inert?: boolean;
  /** 标题不显示（自绘头部时用），仍作为可访问名称 */
  hideTitle?: boolean;
  className?: string;
  /** z 轴层级：二次确认叠在设置弹窗上 */
  layer?: 'base' | 'top';
}

export default function ModalFrame({
  testid,
  title,
  onClose,
  children,
  width = 460,
  initialFocus,
  inert,
  hideTitle,
  className,
  layer = 'base',
}: ModalFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const target =
      (initialFocus ? root?.querySelector<HTMLElement>(initialFocus) : null) ??
      root?.querySelector<HTMLElement>(FOCUSABLE) ??
      root;
    target?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
    // 只在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (inert) return;
    // 内层弹窗（如设置里的删除确认）自己处理按键，外层不重复响应
    const owner = (e.target as HTMLElement).closest?.('[role="dialog"]');
    if (owner && owner !== ref.current) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (n) => !n.closest('[role="dialog"]') || n.closest('[role="dialog"]') === ref.current,
    );
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      data-testid={`${testid}.scrim`}
      className={`fixed inset-0 flex items-center justify-center bg-scrim ${layer === 'top' ? 'z-[60]' : 'z-50'}`}
      onMouseDown={(e) => {
        e.stopPropagation(); // 内层遮罩的点击不传到外层遮罩
        if (inert || e.target !== e.currentTarget) return;
        e.preventDefault();
        closeRef.current();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testid}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ width, maxWidth: 'calc(100vw - 32px)' }}
        className={`mn-modal max-h-[calc(100vh-48px)] overflow-hidden rounded-card border border-line bg-surface outline-none ${className ?? ''}`}
      >
        <h2 id={titleId} className={hideTitle ? 'sr-only' : 'px-6 pt-5 font-serif text-[17px] font-semibold text-ink'}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
