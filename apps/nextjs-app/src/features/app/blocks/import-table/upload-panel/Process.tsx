import { generateAttachmentId } from '@teable/core';
import { X } from '@teable/icons';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { getFieldIconString } from '@teable/sdk';
import { AttachmentManager } from '@teable/sdk/components';
import { Progress } from '@teable/ui-lib';
import { filesize } from 'filesize';
import { useEffect, useState } from 'react';

interface IFileItemProps {
  file: File;
  onClose: () => void;
  onFinished: (result: INotifyVo) => void;
}
const attchmentManager = new AttachmentManager(1);

export const Process = (props: IFileItemProps) => {
  const { file, onClose, onFinished } = props;
  const { name, size, type } = file;

  const [process, setProcess] = useState(0);

  useEffect(() => {
    attchmentManager.upload([{ id: generateAttachmentId(), instance: file }], UploadType.Table, {
      successCallback: (_, result) => {
        onFinished?.(result);
      },
      progressCallback: (_, process) => {
        setProcess(process);
      },
    });
  }, [file, onClose, onFinished]);

  return (
    <>
      <div className="group relative rounded-sm text-sm">
        <img
          className="size-full rounded-sm bg-secondary object-contain p-2"
          src={getFieldIconString(type)}
          alt={name}
        />
        <div>{name}</div>
        <div>{filesize(size)}</div>
        <X
          className="absolute -right-2 -top-2 hidden size-4 cursor-pointer rounded-full bg-secondary p-0.5 group-hover:block hover:opacity-70"
          onClick={() => onClose()}
        />
      </div>
      {<Progress className="absolute top-0" value={process}></Progress>}
    </>
  );
};
