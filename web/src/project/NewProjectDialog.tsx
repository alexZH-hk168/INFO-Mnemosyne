// 规格：2-新建项目-新建项目弹窗（sidebar.new-project-dialog）
// 居中小弹窗：名称输入框（1–60 字）＋取消/创建。样式按卡片弹窗缩小版（无概念图，截图交用户确认）。
// 可访问性：锁焦点、Esc 关闭、关闭后焦点回到触发元素。
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '../api/client';
import type { ProjectList } from '../api/endpoints';
import { queryKeys } from '../api/queries';
import type { Project } from '../api/types';
import { Spinner } from '../icons/Icons';
import { goHome } from '../lib/nav';
import { useChat } from '../store/chat';
import { useUI } from '../store/ui';

export const NAME_MAX = 60;

export default function NewProjectDialog() {
  const qc = useQueryClient();
  const closeModal = useUI((s) => s.closeModal);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const errorId = useId();

  // 打开时聚焦输入框；关闭时把焦点还给触发元素
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const create = useMutation({
    mutationFn: (n: string) => api.post<Project>('/api/projects', { name: n }),
    onSuccess: (p) => {
      // 新项目先插到列表顶部，再失效重取（后端按最近更新排序，新项目本就在最前）
      qc.setQueryData<ProjectList>(queryKeys.projects(), (old) =>
        old ? { projects: [p, ...old.projects.filter((x) => x.id !== p.id)] } : old,
      );
      void qc.invalidateQueries({ queryKey: queryKeys.projects() });
      useChat.getState().setProject(p.id);
      goHome();
      closeModal();
    },
  });

  const trimmed = name.trim();
  const tooLong = [...trimmed].length > NAME_MAX;
  const canSubmit = trimmed.length > 0 && !tooLong && !create.isPending;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (canSubmit) create.mutate(trimmed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    // 锁焦点：在弹窗内循环
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const errorText = create.isError ? create.error.message : tooLong ? `项目名最多 ${NAME_MAX} 个字` : null;

  return (
    <div
      data-testid="sidebar.new-project-dialog.scrim"
      className="fixed inset-0 z-40 flex items-center justify-center bg-scrim"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault(); // 不让浏览器把焦点移到 body，关闭后焦点回到触发元素
        closeModal();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="sidebar.new-project-dialog"
        onKeyDown={onKeyDown}
        className="w-[380px] rounded-card border border-line bg-surface p-5 shadow-2xl"
      >
        <h2 id={titleId} className="font-serif text-[17px] font-semibold text-ink">
          新建项目
        </h2>
        <form onSubmit={submit} className="mt-4">
          <label className="block text-[12px] text-muted" htmlFor={`${titleId}-input`}>
            项目名称
          </label>
          <input
            id={`${titleId}-input`}
            ref={inputRef}
            data-testid="sidebar.new-project-dialog.input"
            value={name}
            readOnly={create.isPending}
            onChange={(e) => {
              setName(e.target.value);
              if (create.isError) create.reset();
            }}
            aria-invalid={errorText ? true : undefined}
            aria-describedby={errorText ? errorId : undefined}
            placeholder="1–60 个字"
            autoComplete="off"
            className="mt-1.5 w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-faint focus:border-handle"
          />
          {errorText && (
            <p
              id={errorId}
              data-testid="sidebar.new-project-dialog.error"
              role="alert"
              className="mt-1.5 text-[12px] text-danger"
            >
              {errorText}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              data-testid="sidebar.new-project-dialog.cancel"
              onClick={closeModal}
              className="mn-focus rounded-btn border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-sel"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="sidebar.new-project-dialog.submit"
              disabled={!canSubmit}
              aria-busy={create.isPending || undefined}
              className="mn-focus inline-flex min-w-[64px] items-center justify-center gap-1.5 rounded-btn bg-ink px-3.5 py-1.5 text-[13px] text-surface disabled:bg-faint"
            >
              {create.isPending ? <Spinner size={13} /> : null}
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
