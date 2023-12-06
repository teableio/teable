import { FileQuestion } from '@teable-group/icons';
import type { IFileItemInner } from './FilePreviewContext';
import { isImage } from './utils';

interface IThumbProps extends IFileItemInner {}

export const Thumb = (props: IThumbProps) => {
  const { thumb, mimetype, src, name } = props;
  if (thumb || isImage(mimetype)) {
    return <img className="w-6 h-6 rounded-sm" src={src || mimetype} alt={name} />;
  }

  return <FileQuestion className="w-6 h-6 rounded-sm" />;
};
