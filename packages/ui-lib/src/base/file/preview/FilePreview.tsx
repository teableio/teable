import { FileQuestion } from '@teable-group/icons';
import { useContext } from 'react';
import { cn } from '../../../shadcn';
import { AudioPreview } from './audio/AudioPreview';
import { FilePreviewContext } from './FilePreviewContext';
import { ImagePreview } from './image/ImagePreview';
import { isAudio, isImage, isVideo } from './utils';
import { VideoPreview } from './video/VideoPreviw';

interface IFilePreviewProps {
  className?: string;
}

export const FilePreview = (props: IFilePreviewProps) => {
  const { className } = props;

  const { currentFile } = useContext(FilePreviewContext);
  if (!currentFile) {
    return null;
  }

  const mimetype = currentFile.mimetype;

  if (isImage(mimetype)) {
    return <ImagePreview {...currentFile} />;
  }

  if (isVideo(mimetype)) {
    return <VideoPreview {...currentFile} />;
  }

  if (isAudio(mimetype)) {
    return <AudioPreview {...currentFile} />;
  }

  return <FileQuestion className={cn('max-w-full max-h-full w-1/2 h-1/2', className)} />;
};
