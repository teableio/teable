import { useCallback, useMemo, useState } from 'react';
import { FilePreviewContent } from './FilePreviewContent';
import type { IFileId, IFileItemInner } from './FilePreviewContext';
import { FilePreviewContext } from './FilePreviewContext';

interface IFilePreviewProvider {
  container?: HTMLElement | null;
  children?: React.ReactNode;
  i18nMap?: Record<string, string>;
}

// Items carry callbacks, so compare fields by identity instead of serializing.
const isSameFileItem = (a: IFileItemInner, b: IFileItemInner) => {
  const aEntries = Object.entries(a);
  return (
    aEntries.length === Object.keys(b).length &&
    aEntries.every(([key, value]) => b[key as keyof IFileItemInner] === value)
  );
};

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
      if (isSameFileItem(pre[index], item)) {
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

  const removeFile = useCallback((fileId: IFileId) => {
    setFiles((pre) => {
      const index = pre.findIndex((file) => file.fileId === fileId);
      if (index === -1) {
        return pre;
      }
      const rest = pre.filter((file) => file.fileId !== fileId);
      // Keep the preview open on the file that took the removed slot, falling
      // back to the new last file. With nothing left the preview closes.
      setCurrent((preCurrent) =>
        preCurrent === fileId ? rest[Math.min(index, rest.length - 1)]?.fileId : preCurrent
      );
      return rest;
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
        removeFile,
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
