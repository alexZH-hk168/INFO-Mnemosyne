// 规格：1-项目栏-新建对话按钮（sidebar.new-chat）
import { ComposeIcon } from '../icons/Icons';
import { goHome } from '../lib/nav';

export default function NewChatButton() {
  return (
    <button
      type="button"
      data-testid="sidebar.new-chat"
      aria-label="新建对话"
      title="新建对话（⌘K）"
      onClick={goHome}
      className="mn-iconbtn"
    >
      <ComposeIcon />
    </button>
  );
}
