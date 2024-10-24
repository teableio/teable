import React, { useState, useEffect } from 'react';
import { Skeleton } from '../../../../shadcn';
import { Spin } from '../../../spin/Spin';
import type { IFileItemInner } from '../FilePreviewContext';
import { urlToBase64 } from './utils';

interface IPdfPreviewProps extends IFileItemInner {}

export const PDFPreview = (props: IPdfPreviewProps) => {
  const [base64, setBase64] = useState('');

  useEffect(() => {
    urlToBase64(props.src).then((res) => {
      setBase64(res.base64WithPrefix);
    });
  }, [props.src]);

  return base64 ? (
    <iframe
      src={base64}
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
