// 规格：2-艾特-文件引用列表（composer.mention）
// 键入 “@” 弹出当前项目已解析（ready）的文件，选中后在文本里插入 `@文件名` 标签，并把引用范围切到“只用已选文件”。
// 数据：['documents', pid]，只列 ready、不列网页快照；按输入的字过滤。
import type { Document } from '../api/types';
import { TypeBadge } from '../files/FileRow';
import MenuList, { type MenuItem } from './MenuList';

export const MENTION_TESTID = 'composer.mention';

export function mentionItems(docs: Document[], query: string): MenuItem[] {
  const q = query.toLowerCase();
  return docs
    .filter((d) => d.title.toLowerCase().includes(q))
    .map((d) => ({
      id: d.id,
      testId: d.id,
      icon: <TypeBadge doc={d} />,
      title: d.title,
    }));
}

interface Props {
  items: MenuItem[];
  /** 项目里一份已解析的材料都没有 */
  noMaterials: boolean;
  active: number;
  onPick: (item: MenuItem) => void;
  onHover: (i: number) => void;
}

export default function MentionMenu({ items, noMaterials, active, onPick, onHover }: Props) {
  return (
    <MenuList
      testid={MENTION_TESTID}
      label="引用文件"
      heading="引用文件 · 只用选中的文件回答"
      items={items}
      active={active}
      empty={noMaterials ? '项目里还没有文件' : '没有匹配的文件'}
      onPick={onPick}
      onHover={onHover}
    />
  );
}
