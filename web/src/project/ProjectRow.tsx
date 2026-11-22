// 规格：1-项目栏-项目行（sidebar.project-row）
// 文件夹图标、项目名、对话数。点击：设为当前项目并展开；当前项目已展开则收起。
import type { Project } from '../api/types';
import { FolderIcon, FolderOpenIcon } from '../icons/Icons';
import ConversationList from './ConversationList';

interface Props {
  project: Project;
  expanded: boolean;
  current: boolean;
  onActivate: (p: Project) => void;
}

export default function ProjectRow({ project: p, expanded, current, onActivate }: Props) {
  return (
    <div>
      <button
        type="button"
        data-testid={`sidebar.project-row:${p.id}`}
        aria-expanded={expanded}
        aria-current={current ? 'true' : undefined}
        onClick={() => onActivate(p)}
        className={`mn-focus flex w-full items-center gap-[9px] rounded-btn px-2 py-1.5 text-left text-[13.5px] hover:bg-sel ${
          current ? 'text-ink' : 'text-ink-2'
        }`}
      >
        {current ? <FolderOpenIcon /> : <FolderIcon />}
        <span className="min-w-0 truncate">{p.name}</span>
        <span className="flex-none text-[12px] text-faint">({p.conversation_count})</span>
      </button>
      {expanded && <ConversationList pid={p.id} />}
    </div>
  );
}
