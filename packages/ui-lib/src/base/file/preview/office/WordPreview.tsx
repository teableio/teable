import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '../../../../shadcn';
import { Spin } from '../../../spin/Spin';
import { FilePreviewContext, type IFileItemInner } from '../FilePreviewContext';
import { getFileIcon } from '../getFileIcon';
import { sanitizePreviewLinks } from '../utils';
import { getBlobFromUrl } from './utils';

interface WordPreviewProps extends IFileItemInner {}

export const WordPreview: React.FC<WordPreviewProps> = ({ src, mimetype }) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const { i18nMap } = useContext(FilePreviewContext);
  const FileIcon = useMemo(() => getFileIcon(mimetype), [mimetype]);

  useEffect(() => {
    const renderDocx = async () => {
      const docxPromise = () => import('docx-preview');
      const docx = await docxPromise();

      if (previewRef.current && src) {
        const container = previewRef.current;
        const blob = await getBlobFromUrl(src);
        const rendering = docx.renderAsync(blob, container, undefined, {
          useBase64URL: true,
        });
        setLoading(false);
        await rendering;
        sanitizePreviewLinks(container);
      }
    };

    setFailed(false);
    // An unreachable or unreadable file would otherwise spin forever as an unhandled rejection.
    renderDocx().catch((e) => {
      console.error('Failed to load Word file:', e);
      setFailed(true);
    });
  }, [src]);

  // docx-preview owns the container's DOM and empties it on every render, so the skeleton and the
  // error overlay it instead of living inside; the container stays mounted for the next src.
  return (
    <div className="size-full relative">
      <div className="size-full overflow-auto rounded-sm relative" ref={previewRef} />
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center text-destructive">
          <span className="flex h-40 w-40 overflow-hidden rounded-3xl" aria-hidden="true">
            <FileIcon className="size-full" />
          </span>
          <span>{i18nMap?.['loadFileError'] || 'Failed to load file'}</span>
        </div>
      ) : (
        loading && (
          <div className="absolute inset-0">
            <Skeleton className="size-full" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <Spin />
            </div>
          </div>
        )
      )}
    </div>
  );
};
