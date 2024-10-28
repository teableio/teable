import React, { useState, useEffect } from 'react';
import { Skeleton } from '../../../../shadcn';
import { Spin } from '../../../spin/Spin';
import type { IFileItemInner } from '../FilePreviewContext';
import { getBlobUrlFromUrl } from './utils';

interface IPdfPreviewProps extends IFileItemInner {}

export const PDFPreview = (props: IPdfPreviewProps) => {
  const [blobUrl, setBlobUrl] = useState('');

  useEffect(() => {
    getBlobUrlFromUrl(props.src).then((res) => {
      setBlobUrl(res);
    });
  }, [props.src]);

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
