import { useCallback, useMemo, useState } from 'react';
import { FilePreviewContent } from './FilePreviewContent';
import type { IFileId, IFileItemInner } from './FilePreviewContext';
import { FilePreviewContext } from './FilePreviewContext';

interface IFilePreviewProvider {
  container?: HTMLElement | null;
  children?: React.ReactNode;
  i18nMap?: Record<string, string>;
}

export const FilePreviewProvider = (props: IFilePreviewProvider) => {
  const { children, container, i18nMap } = props;
  const [current, setCurrent] = useState<number | string>();
  const [files, setFiles] = useState<IFileItemInner[]>([]);

  const currentFile = useMemo(
    () => files.find(({ fileId }) => fileId === current),
    [current, files]
  );

  const openPreview = useCallback((fileId?: number | string) => {
    setCurrent(fileId ?? 0);
  }, []);

  const closePreview = useCallback(() => {
    setCurrent(undefined);
  }, []);

  const mergeFiles = useCallback((item: IFileItemInner) => {
    setFiles((pre) => {
      const index = pre.findIndex((v) => v.fileId === item.fileId);
      if (index === -1) {
        return [...pre, item];
      }
      if (JSON.stringify(pre[index]) === JSON.stringify(item)) {
        return pre;
      }
      const newFiles = [...pre];
      newFiles.splice(index, 1, item);
      return newFiles;
    });
  }, []);

  const resetFiles = useCallback((files?: IFileItemInner[]) => {
    setFiles(files ?? []);
  }, []);

  const onDelete = useCallback((fileId: IFileId) => {
    setFiles((pre) => {
      const index = pre.findIndex((file) => file.fileId === fileId);
      if (index > -1) {
        setCurrent((preCurrent) =>
          preCurrent === fileId ? pre[index > 0 ? index - 1 : 0].fileId : preCurrent
        );
        return pre.filter((file) => file.fileId !== fileId);
      }
      return pre;
    });
  }, []);

  const onPrev = useCallback(() => {
    const index = files.findIndex(({ fileId }) => fileId === current);
    if (index === -1) {
      return;
    }
    const prevIndex = index - 1;
    if (prevIndex < 0) {
      return;
    }
    setCurrent(files[prevIndex].fileId);
  }, [current, files]);

  const onNext = useCallback(() => {
    const index = files.findIndex(({ fileId }) => fileId === current);
    if (index === -1) {
      return;
    }
    const nextIndex = index + 1;
    if (nextIndex >= files.length) {
      return;
    }
    setCurrent(files[nextIndex].fileId);
  }, [current, files]);

  return (
    <FilePreviewContext.Provider
      value={{
        currentFile,
        files,
        mergeFiles,
        resetFiles,
        onDelete,
        openPreview,
        closePreview,
        onPrev,
        onNext,
        i18nMap: i18nMap,
      }}
    >
      {children}
      {files.length > 0 && <FilePreviewContent container={container} />}
    </FilePreviewContext.Provider>
  );
};
