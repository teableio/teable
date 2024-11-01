import React, { useEffect, useRef, useState } from 'react';
import { Skeleton } from '../../../../shadcn';
import { Spin } from '../../../spin/Spin';
import type { IFileItemInner } from '../FilePreviewContext';
import { getBlobFromUrl } from './utils';

interface WordPreviewProps extends IFileItemInner {}

export const WordPreview: React.FC<WordPreviewProps> = ({ src }) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const renderDocx = async () => {
      const docxPromise = () => import('docx-preview');
      const docx = await docxPromise();

      if (previewRef.current && src) {
        const blob = await getBlobFromUrl(src);
        docx.renderAsync(blob, previewRef.current, undefined, {
          useBase64URL: true,
        });
        setLoading(false);
      }
    };

    renderDocx();
  }, [src]);

  return (
    <div className="size-full overflow-auto rounded-sm relative" ref={previewRef}>
      {loading && (
        <div className="size-full relative">
          <Skeleton className="size-full" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <Spin />
          </div>
        </div>
      )}
    </div>
  );
};
