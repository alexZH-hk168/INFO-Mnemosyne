// 规格：1-文件栏-拖拽上传区（files.dropzone）
// 文件栏底部虚线框；整个文件栏也接受拖放（useFileDrop.ts 挂在文件栏根元素上）。拖入悬停：虚线变实线并加底色。

export const DROP_TEXT = '拖入 PDF / PPT / 代码，自动解析并建索引';

export default function UploadDropzone({ active }: { active: boolean }) {
  return (
    <div
      data-testid="files.dropzone"
      data-active={active || undefined}
      className={`mx-1.5 mt-3 flex-none rounded-card-sm border px-2.5 py-2.5 text-center text-[11.5px] leading-[1.55] text-muted transition-colors ${
        active ? 'border-solid border-handle bg-sel text-ink-2' : 'border-dashed border-drop-line'
      }`}
    >
      {DROP_TEXT}
    </div>
  );
}
