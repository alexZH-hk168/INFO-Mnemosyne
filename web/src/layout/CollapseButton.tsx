// 规格：1-外壳-栏收起按钮（shell.collapse-button）
import { PanelIcon } from '../icons/Icons';
import type { PanelIndex } from '../store/layout';
import { usePanelControl } from './panelControl';

const LABEL: Record<number, string> = { 0: '收起项目栏', 1: '收起文件栏', 3: '收起右栏' };

export default function CollapseButton({ index }: { index: Exclude<PanelIndex, 2> }) {
  const { toggle } = usePanelControl();
  return (
    <button
      type="button"
      data-testid={`shell.collapse-button:${index}`}
      aria-label={LABEL[index]}
      title={LABEL[index]}
      onClick={() => toggle(index)}
      className="mn-iconbtn"
    >
      <PanelIcon side={index === 3 ? 'right' : 'left'} />
    </button>
  );
}
