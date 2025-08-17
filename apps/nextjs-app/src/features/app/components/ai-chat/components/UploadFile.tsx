import { UploadType } from '@teable/openapi';
import React, { useImperativeHandle, useRef, useState } from 'react';
import { uploadFiles } from '@/features/app/utils/uploadFile';

interface IUploadFileProps {
  children: React.ReactNode;
}

export interface IUploadFileRef {
  getFiles: () => IFile[];
  click: () => void;
}

interface IFile {
  name?: string;
  contentType?: string;
  url: string;
}

export const UploadFile = React.forwardRef<IUploadFileRef, IUploadFileProps>(
  ({ children }, ref) => {
    const fileInput = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<IFile[]>([]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      uploadFiles(files, UploadType.Chat).then((res) => {
        const files = res.map((file) => ({
          name: file.name,
          contentType: file.mimetype,
          url: file.url,
        }));
        setFiles(files);
      });
    };

    useImperativeHandle(ref, () => ({
      getFiles: () => files,
      click: () => {
        fileInput.current?.click();
      },
    }));

    return (
      <>
        {children}
        <input multiple ref={fileInput} type="file" className="hidden" onChange={handleChange} />
        <div className="flex items-center gap-2">
          {files.map((file) => (
            <div key={file.url}>{file.name}</div>
          ))}
        </div>
      </>
    );
  }
);

UploadFile.displayName = 'UploadFile';
