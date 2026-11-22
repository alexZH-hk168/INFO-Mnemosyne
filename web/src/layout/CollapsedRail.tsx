// 规格：1-外壳-收起态竖条（shell.collapsed-rail）
import { PanelIcon } from '../icons/Icons';
import { useLayout, type PanelIndex } from '../store/layout';
import { usePanelControl } from './panelControl';

const NAME: Record<number, string> = { 0: '项目', 1: '文件', 3: '预览' };
const EXPAND_LABEL: Record<number, string> = { 0: '展开项目栏', 1: '展开文件栏', 3: '展开右栏' };

export default function CollapsedRail({ index }: { index: Exclude<PanelIndex, 2> }) {
  const { toggle } = usePanelControl();
  const tabCount = useLayout((s) => s.rightTabs.length);
  return (
    // 点竖条空白处也能展开；键盘用户用顶部按钮
    <div
      data-testid={`shell.collapsed-rail:${index}`}
      onClick={() => toggle(index)}
      className="mn-floating flex h-full w-[44px] flex-none cursor-pointer flex-col items-center gap-2.5 pt-2 text-muted"
    >
      <button
        type="button"
        data-testid={`shell.collapsed-rail.expand:${index}`}
        aria-label={EXPAND_LABEL[index]}
        title={EXPAND_LABEL[index]}
        onClick={(e) => {
          e.stopPropagation();
          toggle(index);
        }}
        className="mn-iconbtn"
      >
        <PanelIcon side={index === 3 ? 'right' : 'left'} />
      </button>
      <span className="mn-vertical select-none text-[11.5px] text-faint">{NAME[index]}</span>
      {index === 3 && tabCount > 0 && (
        <span
          data-testid="shell.collapsed-rail.tab-count"
          aria-label={`已打开 ${tabCount} 个标签`}
          className="rounded-pill bg-panel-2 px-1.5 text-[11px] leading-[18px] text-muted"
        >
          {tabCount}
        </span>
      )}
    </div>
  );
}
