import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Skeleton } from '../../../../shadcn';
import { Spin } from '../../../spin/Spin';
import { FilePreviewContext, type IFileItemInner } from '../FilePreviewContext';
import { getFileIcon } from '../getFileIcon';
import { getBlobUrlFromUrl } from './utils';

interface IPdfPreviewProps extends IFileItemInner {}

export const PDFPreview = (props: IPdfPreviewProps) => {
  const [blobUrl, setBlobUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const { i18nMap } = useContext(FilePreviewContext);
  const FileIcon = useMemo(() => getFileIcon(props.mimetype), [props.mimetype]);

  useEffect(() => {
    setFailed(false);
    // An unreachable file would otherwise spin forever as an unhandled rejection.
    getBlobUrlFromUrl(props.src)
      .then((res) => {
        setBlobUrl(res);
      })
      .catch((e) => {
        console.error('Failed to load PDF file:', e);
        setFailed(true);
      });
  }, [props.src]);

  if (failed) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-4 px-6 text-center text-destructive">
        <span className="flex h-40 w-40 overflow-hidden rounded-3xl" aria-hidden="true">
          <FileIcon className="size-full" />
        </span>
        <span>{i18nMap?.['loadFileError'] || 'Failed to load file'}</span>
      </div>
    );
  }

  return blobUrl ? (
    <iframe
      src={blobUrl}
      width="100%"
      height="100%"
      title="PDF Viewer"
      loading="lazy"
      className="border-none rounded-sm"
    />
  ) : (
    <div className="size-full relative">
      <Skeleton className="size-full" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <Spin />
      </div>
    </div>
  );
};
