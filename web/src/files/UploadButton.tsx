// 规格：1-文件栏-上传按钮（files.upload-button）
// 打开系统文件选择框（可多选）；上传中图标变转圈，仍可继续选择。
import { useRef } from 'react';
import { Spinner, UploadIcon } from '../icons/Icons';
import { ACCEPT_ATTR } from '../lib/upload';

interface Props {
  uploading: boolean;
  disabled?: boolean;
  onFiles: (files: FileList | null) => void;
}

export default function UploadButton({ uploading, disabled, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        data-testid="files.upload-button"
        aria-label="上传文件"
        title="上传 PDF / PPT / 代码 / 笔记"
        aria-busy={uploading || undefined}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mn-iconbtn disabled:opacity-40"
      >
        {uploading ? <Spinner size={15} /> : <UploadIcon />}
      </button>
      <input
        ref={inputRef}
        data-testid="files.upload-button.input"
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = ''; // 允许再次选择同一个文件
        }}
      />
    </>
  );
}
