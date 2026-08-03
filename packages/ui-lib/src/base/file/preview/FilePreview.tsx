import { useContext, useMemo } from 'react';
import { cn } from '../../../shadcn';
import { AudioPreview } from './audio/AudioPreview';
import { FilePreviewContext } from './FilePreviewContext';
import { getFileIcon } from './getFileIcon';
import { HtmlPreview } from './html/HtmlPreview';
import { ImagePreview } from './image/ImagePreview';
import { ExcelPreview } from './office/ExcelPreview';
import { WordPreview } from './office/WordPreview';
import { PDFPreview } from './pdf/PDFPreview';
import { TextPreview } from './text/TextPreview';
import { isAudio, isImage, isVideo, isPdf, isWord, isExcel, isTextLike, isHtml } from './utils';
import { VideoPreview } from './video/VideoPreview';

interface IFilePreviewProps {
  className?: string;
}

export const FilePreview = (props: IFilePreviewProps) => {
  const { className } = props;
  const { currentFile, closePreview } = useContext(FilePreviewContext);

  const mimetype = currentFile?.mimetype;

  const FileIcon = useMemo(() => (mimetype ? getFileIcon(mimetype) : ''), [mimetype]);

  if (!mimetype || !FileIcon) {
    return null;
  }

  switch (true) {
    case isImage(mimetype):
      return <ImagePreview {...currentFile} onClose={closePreview} />;
    case isVideo(mimetype):
      return <VideoPreview {...currentFile} />;
    case isAudio(mimetype):
      return <AudioPreview {...currentFile} />;
    case isPdf(mimetype):
      return <PDFPreview {...currentFile} />;
    case isExcel(mimetype):
      return <ExcelPreview {...currentFile} />;
    case isWord(mimetype):
      return <WordPreview {...currentFile} />;
    case isHtml(mimetype):
      return <HtmlPreview {...currentFile} />;
    case isTextLike(mimetype):
      return <TextPreview {...currentFile} />;
    default:
      return <FileIcon className={cn('max-w-max max-h-max w-40 h-40 ', className)} />;
  }
};
