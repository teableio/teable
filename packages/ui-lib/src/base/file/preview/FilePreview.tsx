import { FileQuestion } from '@teable-group/icons';
import { useContext } from 'react';
import { cn } from '../../../shadcn';
import { FilePreviewContext } from './FilePreviewContext';
import { ImagePreview } from './image/ImagePreview';
import { isImage } from './utils';

interface IFilePreviewProps {
  className?: string;
}

export const FilePreview = (props: IFilePreviewProps) => {
  const { className } = props;

  const { currentFile } = useContext(FilePreviewContext);
  if (!currentFile) {
    return null;
  }

  if (isImage(currentFile.mimetype)) {
    return <ImagePreview {...currentFile} />;
  }

  return <FileQuestion className={cn('max-w-full max-h-full w-1/2 h-1/2', className)} />;
};
