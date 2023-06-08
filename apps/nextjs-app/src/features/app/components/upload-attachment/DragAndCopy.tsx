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
    <div className="w-full h-full flex flex-col">
      <div
        className={classNames(
          'flex-1 w-full bg-base-200/80 text-base-content/70 rounded-md flex items-center justify-center',
          {
            'border border-accent-focus': isFileDragIn,
          }
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
