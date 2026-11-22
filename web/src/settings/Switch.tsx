// 设置弹窗里用的开关（概念图 UI-11 的 .tg 样式：32×18，开启为 --ok）。
export default function Switch({
  testid,
  label,
  checked,
  onChange,
  disabled,
}: {
  testid: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testid}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`mn-focus relative h-[18px] w-8 flex-none rounded-pill transition-colors disabled:opacity-60 ${
        checked ? 'bg-ok' : 'bg-[var(--perm-note)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-pill bg-surface shadow transition-[left] motion-reduce:transition-none ${
          checked ? 'left-4' : 'left-0.5'
        }`}
      />
    </button>
  );
}
