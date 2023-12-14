import { useMemo } from 'react';
import type { IFileItemInner } from './FilePreviewContext';
import { getFileIcon } from './getFileIcon';
import { isImage } from './utils';

interface IThumbProps extends IFileItemInner {}

export const Thumb = (props: IThumbProps) => {
  const { thumb, mimetype, src, name } = props;
  const FileIcon = useMemo(() => getFileIcon(mimetype), [mimetype]);

  if (thumb || isImage(mimetype)) {
    return <img className="w-6 h-6 rounded-sm" src={src || mimetype} alt={name} />;
  }

  return <FileIcon className="w-6 h-6 rounded-sm" />;
};
