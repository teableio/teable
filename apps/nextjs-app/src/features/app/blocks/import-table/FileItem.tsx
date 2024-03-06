import { generateAttachmentId } from '@teable/core';
import { X } from '@teable/icons';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { getFieldIconString } from '@teable/sdk';
import { AttachmentManager } from '@teable/sdk/components';
import { Progress } from '@teable/ui-lib';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { filesize } from 'filesize';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';

interface IFileItemProps {
  file: File;
  accept?: string;
  onClose: () => void;
  onFinished: (result: INotifyVo) => void;
}

export const FileItem = (props: IFileItemProps) => {
  const { file, onClose, onFinished, accept } = props;
  const { name, size, type } = file;

  const { t } = useTranslation(['table']);
  const [process, setProcess] = useState(0);

  useEffect(() => {
    if (accept && type !== accept) {
      onClose();
      toast.error(t('table:import.form.error.errorFileFormat'));
      return;
    }

    const attchmentManager = new AttachmentManager(1);
    attchmentManager.upload([{ id: generateAttachmentId(), instance: file }], UploadType.Table, {
      successCallback: (_, result) => {
        onFinished?.(result);
      },
      progressCallback: (_, process) => {
        setProcess(process);
      },
    });
  }, [accept, file, onClose, onFinished, t, type]);

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
