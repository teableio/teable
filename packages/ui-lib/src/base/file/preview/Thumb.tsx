import { useMemo } from 'react';
import { ImageWithFallback } from '../ImageWithFallback';
import type { IFileItemInner } from './FilePreviewContext';
import { getFileIcon } from './getFileIcon';
import { isImage } from './utils';

interface IThumbProps extends IFileItemInner {}

export const Thumb = (props: IThumbProps) => {
  const { thumb, mimetype, src, name } = props;
  const FileIcon = useMemo(() => getFileIcon(mimetype), [mimetype]);
  const imageSrc = thumb || (isImage(mimetype) ? src : undefined);

  return (
    <ImageWithFallback
      className="w-6 h-6 rounded-sm"
      src={imageSrc}
      alt={name}
      fallback={<FileIcon className="w-6 h-6 rounded-sm" />}
    />
  );
};
