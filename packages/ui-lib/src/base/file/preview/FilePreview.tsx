import { lazy, Suspense, useContext, useMemo } from 'react';
import { cn, Skeleton } from '../../../shadcn';
import { Spin } from '../../spin/Spin';
import { AudioPreview } from './audio/AudioPreview';
import { FilePreviewContext } from './FilePreviewContext';
import { getFileIcon } from './getFileIcon';
import { HtmlPreview } from './html/HtmlPreview';
import { ImagePreview } from './image/ImagePreview';
import { WordPreview } from './office/WordPreview';
import { PDFPreview } from './pdf/PDFPreview';
import { TextPreview } from './text/TextPreview';
import { isAudio, isImage, isVideo, isPdf, isWord, isExcel, isTextLike, isHtml } from './utils';
import { VideoPreview } from './video/VideoPreview';

// Its spreadsheet grid is heavy; load it when an Excel file is opened.
const ExcelPreview = lazy(() =>
  import('./office/ExcelPreview').then((mod) => ({ default: mod.ExcelPreview }))
);

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
      return (
        <Suspense
          fallback={
            <div className="relative size-full">
              <Skeleton className="size-full" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <Spin />
              </div>
            </div>
          }
        >
          <ExcelPreview {...currentFile} />
        </Suspense>
      );
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
