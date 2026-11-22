// 上传流程：上传按钮与拖拽上传区共用。前端先按 accept 拦截不支持的类型并提示，其余调 uploadFiles，成功后失效 ['documents', pid]。
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { queryKeys } from '../api/queries';
import type { ID } from '../api/types';
import { rejectedText, splitAccepted, uploadFiles } from '../lib/upload';
import { useUI } from '../store/ui';

export function useUpload(pid: ID | null) {
  const qc = useQueryClient();
  const [inFlight, setInFlight] = useState(0);
  const m = useMutation({
    mutationFn: ({ project, files }: { project: ID; files: File[] }) => uploadFiles(project, files),
    onMutate: () => setInFlight((n) => n + 1),
    onSettled: (_d, _e, vars) => {
      setInFlight((n) => Math.max(0, n - 1));
      void qc.invalidateQueries({ queryKey: queryKeys.documents(vars.project) });
    },
    onError: (e) => useUI.getState().pushToast({ kind: 'error', text: `上传失败：${(e as Error).message}` }),
  });

  /** 返回实际提交上传的文件数 */
  const upload = (list: FileList | File[] | null | undefined): number => {
    const files = Array.from(list ?? []);
    if (!pid || files.length === 0) return 0;
    const { ok, rejected } = splitAccepted(files);
    if (rejected.length > 0) useUI.getState().pushToast({ kind: 'error', text: rejectedText(rejected) });
    if (ok.length > 0) m.mutate({ project: pid, files: ok });
    return ok.length;
  };

  return { upload, uploading: inFlight > 0 };
}
