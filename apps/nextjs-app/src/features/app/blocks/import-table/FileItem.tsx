import { generateAttachmentId } from '@teable/core';
import { X } from '@teable/icons';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { getFieldIconString } from '@teable/sdk';
import { AttachmentManager } from '@teable/sdk/components';
import { Progress } from '@teable/ui-lib';
import { useEffect, useState } from 'react';

interface IFileItemProps {
  file: File;
  onClose: (file: File) => void;
  onFinished: (result: INotifyVo) => void;
}

export const FileItem = (props: IFileItemProps) => {
  const { file, onClose, onFinished } = props;
  const { name, size, type } = file;

  const [process, setProcess] = useState(0);

  useEffect(() => {
    const attchmentManager = new AttachmentManager(1);
    attchmentManager.upload([{ id: generateAttachmentId(), instance: file }], UploadType.Table, {
      successCallback: (file, result) => {
        onFinished?.(result);
      },
      progressCallback: (file, process) => {
        setProcess(process);
      },
    });
  }, [file, onFinished]);

  return (
    <>
      <div className="group relative rounded-sm text-sm">
        <img
          className="size-full rounded-sm bg-secondary object-contain p-2"
          src={getFieldIconString(type)}
          alt={name}
        />
        <div>{name}</div>
        <div>{size}</div>
        <X
          className="absolute -right-2 -top-2 hidden size-4 cursor-pointer rounded-full bg-secondary p-0.5 group-hover:block hover:opacity-70"
          onClick={() => onClose(file)}
        />
      </div>
      {<Progress className="absolute top-0" value={process}></Progress>}
    </>
  );
};
