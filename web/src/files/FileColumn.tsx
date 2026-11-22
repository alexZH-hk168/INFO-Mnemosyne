// 规格：1-外壳-文件栏（files.panel）
// 标题“文件 · 项目名”、上传与收起按钮、按 Document.group 分组的材料、底部拖拽上传区；整个文件栏接受拖放。
import { useDocuments, useProjects } from '../api/queries';
import CollapseButton from '../layout/CollapseButton';
import { isNetworkError } from '../lib/errors';
import { useChat } from '../store/chat';
import FileGroup from './FileGroup';
import UploadButton from './UploadButton';
import UploadDropzone from './UploadDropzone';
import { useFileDrop } from './useFileDrop';
import { useUpload } from './useUpload';

export default function FileColumn() {
  const projectId = useChat((s) => s.projectId);
  const projects = useProjects();
  const docs = useDocuments(projectId);
  const { upload, uploading } = useUpload(projectId);
  const { active, handlers } = useFileDrop((files) => upload(files));
  const projectName = projects.data?.projects.find((p) => p.id === projectId)?.name ?? '';
  const offline = docs.isError && isNetworkError(docs.error);
  const loading = !projectId || docs.isPending || offline;

  return (
    <section
      data-testid="files.panel"
      aria-label="文件"
      {...handlers}
      className="mn-floating flex h-full flex-col px-2 pb-2.5 pt-3"
    >
      <div className="flex flex-none items-center gap-1.5 pb-2.5 pl-1.5 pr-1">
        <span className="flex-none text-[13.5px] font-semibold text-ink">文件</span>
        <span data-testid="files.panel.project-name" className="min-w-0 truncate text-[12px] text-muted">
          {projectName}
        </span>
        <span className="flex-1" />
        <UploadButton uploading={uploading} disabled={!projectId} onFiles={(f) => upload(f)} />
        <CollapseButton index={1} />
      </div>

      <div data-testid="files.list" className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div data-testid="files.list.loading" aria-busy="true" className="space-y-3 px-2 py-2">
            <div className="mn-skel h-4 w-[85%]" />
            <div className="mn-skel h-4 w-[70%]" />
            <div className="mn-skel h-4 w-[78%]" />
            <div className="mn-skel h-4 w-[60%]" />
          </div>
        )}
        {docs.isError && !offline && (
          <button
            type="button"
            data-testid="files.list.retry"
            onClick={() => void docs.refetch()}
            className="mn-focus px-2 py-1.5 text-[12.5px] text-muted hover:text-ink"
          >
            加载失败 · 重试
          </button>
        )}
        {docs.data?.groups.map((g) => (
          <FileGroup key={g.group} group={g.group} documents={g.documents} />
        ))}
        <UploadDropzone active={active} />
      </div>
    </section>
  );
}
