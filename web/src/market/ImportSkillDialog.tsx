// 规格：2-市场页-导入Skill（market.import-skill）
// Skill 市场标签右上“导入”：填 GitHub 目录地址或本机路径，POST /api/skills/import `{source, url|path}`；
// 校验失败（SKILL_INVALID 等）在输入框下显示红字。无概念图（未决 U7），实现后截图交用户确认。
import { useId, useState, type FormEvent } from 'react';
import { Spinner } from '../icons/Icons';
import { useUI } from '../store/ui';
import { useImportSkill } from './hooks';
import { ImportIcon } from './icons';
import ModalFrame from './ModalFrame';

type Source = 'github' | 'local';

/** 右上的“导入”按钮 + 弹窗（弹窗只用组件内部 state，不进 useUI.modal） */
export default function ImportSkillButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="market.import-skill"
        onClick={() => setOpen(true)}
        className="mn-focus flex flex-none items-center gap-1.5 rounded-btn border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 hover:bg-sel"
      >
        <ImportIcon size={13} />
        导入
      </button>
      {open && <ImportSkillDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function ImportSkillDialog({ onClose }: { onClose: () => void }) {
  const pushToast = useUI((s) => s.pushToast);
  const importSkill = useImportSkill();
  const [source, setSource] = useState<Source>('github');
  const [value, setValue] = useState('');
  const errId = useId();
  const inputId = useId();

  const trimmed = value.trim();
  const localError =
    source === 'github' && trimmed && !/^https:\/\/github\.com\/\S+/.test(trimmed)
      ? '请填写 https://github.com/ 开头的目录地址'
      : null;
  const error = localError ?? (importSkill.isError ? importSkill.error.message : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || localError || importSkill.isPending) return;
    importSkill.mutate(source === 'github' ? { source, url: trimmed } : { source, path: trimmed }, {
      onSuccess: (skill) => {
        pushToast({ kind: 'success', text: `已导入 Skill「${skill.name}」` });
        onClose();
      },
    });
  };

  return (
    <ModalFrame
      testid="market.import-skill.dialog"
      title="导入 Skill"
      onClose={onClose}
      width={460}
      initialFocus="input[type=text]"
    >
      <form onSubmit={submit} className="px-6 pb-5 pt-2">
        <p className="text-[12.5px] leading-[1.6] text-muted">
          Skill 是一个根目录含 SKILL.md 的文件夹，头部必须写 name 与 description。附带脚本第一版不执行。
        </p>
        <div
          role="radiogroup"
          aria-label="来源"
          className="mt-4 inline-flex rounded-btn border border-line p-0.5 text-[12.5px]"
        >
          {(
            [
              ['github', 'GitHub 目录'],
              ['local', '本机路径'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={source === k}
              data-testid={`market.import-skill.source:${k}`}
              onClick={() => {
                setSource(k);
                importSkill.reset();
              }}
              className={`mn-focus rounded-btn-sm px-3 py-1 ${source === k ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-sel'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label htmlFor={inputId} className="mt-4 block text-[12px] text-muted">
          {source === 'github' ? '目录地址' : '本机文件夹路径'}
        </label>
        <input
          id={inputId}
          type="text"
          data-testid="market.import-skill.input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (importSkill.isError) importSkill.reset();
          }}
          placeholder={source === 'github' ? 'https://github.com/<owner>/<repo>/tree/main/<目录>' : '~/skills/<文件夹>'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          autoComplete="off"
          spellCheck={false}
          className="mt-1.5 w-full rounded-btn border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-handle aria-[invalid=true]:border-danger"
        />
        {error && (
          <p id={errId} role="alert" data-testid="market.import-skill.error" className="mt-1.5 text-[12px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="market.import-skill.cancel"
            onClick={onClose}
            className="mn-focus rounded-btn border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-2 hover:bg-sel"
          >
            取消
          </button>
          <button
            type="submit"
            data-testid="market.import-skill.submit"
            disabled={!trimmed || !!localError || importSkill.isPending}
            aria-busy={importSkill.isPending || undefined}
            className="mn-focus inline-flex min-w-[64px] items-center justify-center gap-1.5 rounded-btn bg-ink px-3.5 py-1.5 text-[13px] text-surface disabled:bg-faint"
          >
            {importSkill.isPending && <Spinner size={13} />}
            导入
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
