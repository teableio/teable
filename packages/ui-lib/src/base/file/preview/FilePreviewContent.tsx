/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import { X, ChevronRight, Download } from '@teable/icons';
import { useContext, useMemo } from 'react';
import { Dialog, DialogContent, DialogTrigger, cn } from '../../../shadcn';
import { FilePreview } from './FilePreview';
import { FilePreviewContext } from './FilePreviewContext';
import { Thumb } from './Thumb';

export const FilePreviewContent = (props: { container?: HTMLElement | null }) => {
  const { container } = props;
  const { files, currentFile, openPreview, closePreview, onPrev, onNext } =
    useContext(FilePreviewContext);
  const { name, fileId, src } = currentFile || {};
  const open = Boolean(fileId);

  const hiddenLeft = useMemo(() => {
    return files.length < 2 || currentFile?.fileId === files[0].fileId;
  }, [currentFile?.fileId, files]);
  const hiddenRight = useMemo(() => {
    return files.length < 2 || currentFile?.fileId === files[files.length - 1].fileId;
  }, [currentFile?.fileId, files]);

  const clickFileBox = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if ('id' in e.target && e.target.id === 'file-box') {
      closePreview();
    }
  };

  const onDownload = () => {
    if (!name || !src) return;
    const downloadLink = document.createElement('a');
    downloadLink.href = src || '';
    downloadLink.target = '_blank';
    downloadLink.download = name;
    downloadLink.click();
  };

  return (
    <Dialog open={open} modal>
      <DialogTrigger asChild />
      <DialogContent
        container={container}
        closeable={false}
        className="w-full h-full max-w-none bg-black/75 text-white rounded-none px-4 py-0 click-outside-ignore pointer-events-none"
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            closePreview();
          }
          if (e.key === 'ArrowRight') {
            onNext();
          }
          if (e.key === 'ArrowLeft') {
            onPrev();
          }
          e.stopPropagation();
        }}
      >
        <div className="flex flex-col max-h-full overflow-hidden">
          <div className="relative py-4">
            <h2 className="text-center">{name}</h2>
            <button
              className="absolute top-4 right-5 p-1 rounded-md hover:bg-black/40"
              onClick={closePreview}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  closePreview();
                }
              }}
            >
              <X className="text-xl" />
            </button>
            <button
              className="absolute top-4 left-5 p-1 rounded-md hover:bg-black/40"
              onClick={onDownload}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onDownload();
                }
              }}
            >
              <Download className="text-xl" />
            </button>
          </div>
          <div className="flex-1 relative px-20 overflow-hidden">
            <button
              className={cn(
                'absolute left-0 top-[50%] -translate-y-1/2 ml-0.5',
                hiddenLeft && 'hidden'
              )}
              onClick={onPrev}
            >
              <ChevronRight className="rotate-180 text-6xl" />
            </button>
            <div
              id="file-box"
              className="h-full flex items-center justify-center"
              onClick={clickFileBox}
            >
              <FilePreview />
            </div>
            <button
              className={cn(
                'absolute right-0 top-[50%] -translate-y-1/2 mr-0.5',
                hiddenRight && 'hidden'
              )}
              onClick={onNext}
            >
              <ChevronRight className="text-6xl" />
            </button>
          </div>
          <div className="relative py-4 px-6">
            <div className="flex justify-center gap-2">
              {files.map(({ fileId, ...item }) => (
                <button
                  className={cn(
                    'cursor-pointer rounded-md border-2 border-transparent',
                    fileId === currentFile?.fileId && 'border-2 border-white border-solid p-0'
                  )}
                  key={fileId}
                  onClick={() => {
                    if (fileId !== currentFile?.fileId) {
                      openPreview(fileId);
                    }
                  }}
                >
                  <Thumb {...{ ...item, fileId }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
