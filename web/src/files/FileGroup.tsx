// 规格：1-文件栏-文件分组（files.group）
// 一个类别的小标题（论文 / 课件 / 代码 / 笔记 / 网页来源）＋数量＋行列表；组为空不渲染。
import type { DocGroup, Document } from '../api/types';
import { GROUP_LABEL } from '../lib/documents';
import FileRow from './FileRow';
import WebRow from './WebRow';

export default function FileGroup({ group, documents }: { group: DocGroup; documents: Document[] }) {
  if (documents.length === 0) return null;
  return (
    <section data-testid={`files.group:${group}`} aria-label={GROUP_LABEL[group]}>
      <div className="flex justify-between px-2 pb-1 pt-2.5 text-[11.5px] text-muted">
        <span>{GROUP_LABEL[group]}</span>
        <span data-testid={`files.group.count:${group}`}>{documents.length}</span>
      </div>
      {documents.map((d) =>
        group === 'web' ? <WebRow key={d.id} document={d} /> : <FileRow key={d.id} document={d} />,
      )}
    </section>
  );
}
