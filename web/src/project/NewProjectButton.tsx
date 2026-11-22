// 规格：1-项目栏-新建项目按钮（sidebar.new-project）
import { PlusIcon } from '../icons/Icons';
import { useUI } from '../store/ui';

export default function NewProjectButton() {
  const openModal = useUI((s) => s.openModal);
  return (
    <button
      type="button"
      data-testid="sidebar.new-project"
      aria-label="新建项目"
      title="新建项目"
      onClick={() => openModal('new-project')}
      className="mn-iconbtn -my-[5px] h-6 w-6"
    >
      <PlusIcon size={14} />
    </button>
  );
}
