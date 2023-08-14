import classNames from 'classnames';
import { useState } from 'react';

export const DragAndCopy = (props: { onChange?: (files: FileList) => void }) => {
  const [isFileDragIn, setIsFileDragIn] = useState(false);

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    uploadFiles(files);
  };

  const handleFilePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const clipboardData = e.clipboardData;
    uploadFiles(clipboardData.files);
  };

  const uploadFiles = (files: FileList) => {
    if (files.length === 0) return;
    props.onChange?.(files);
  };

  return (
    <div className="w-full h-16 flex flex-col focus:bg-red">
      <div
        className={classNames(
          'flex-1 w-full bg-foreground/5 text-foreground/60 rounded-md flex items-center justify-center border border-dashed',
          isFileDragIn && 'border-foreground'
        )}
        onDrop={handleFileDrop}
        onDragEnter={() => setIsFileDragIn(true)}
        onDragLeave={() => setIsFileDragIn(false)}
        onDragOver={(e) => e.preventDefault()}
        onPaste={handleFilePaste}
      >
        {isFileDragIn ? 'Release to upload file.' : 'Paste or drag and drop to upload here.'}
      </div>
    </div>
  );
};
