import type { IAttachmentItem, IAttachmentCellValue } from '@teable-group/core';
import { generateAttachmentId } from '@teable-group/core';
import { X, Download } from '@teable-group/icons';
import type { INotifyVo } from '@teable-group/openapi';
import { Button, Progress } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { debounce, map, omit } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDrop } from 'react-use';
import { getFileCover } from '../utils';
import { DragAndCopy } from './DragAndCopy';
import { FileInput } from './FileInput';
import type { IFile } from './uploadManage';
import { AttachmentManager } from './uploadManage';

export interface IUploadAttachment {
  attachments: IAttachmentCellValue;
  onChange: (attachment: IAttachmentCellValue) => void;
  disabled?: boolean;
}

type IUploadFileMap = { [key: string]: { progress: number; file: File } };

const attachmentManager = new AttachmentManager(2);

export const UploadAttachment = (props: IUploadAttachment) => {
  const { attachments, onChange, disabled } = props;
  const [uploadingFiles, setUploadingFiles] = useState<IUploadFileMap>({});
  const listRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<IAttachmentCellValue>(attachments);

  attachmentsRef.current = attachments;

  const onDelete = (id: string) => {
    onChange(attachments.filter((attachment) => attachment.id !== id));
  };

  const downloadFile = ({ url, name }: IAttachmentItem) => {
    window.open(`${url}?filename=${name}`);
  };

  const handleSuccess = useCallback(
    (file: IFile, attachment: INotifyVo) => {
      const { id, instance } = file;

      const newAttachment: IAttachmentItem = {
        id,
        name: instance.name,
        ...attachment,
      };
      setUploadingFiles((pre) => omit(pre, file.id));
      onChange([...attachmentsRef.current, newAttachment]);
    },
    [onChange]
  );

  const uploadAttachment = useCallback(
    (files: File[]) => {
      const uploadList = files.map((v) => ({ instance: v, id: generateAttachmentId() }));

      const newUploadMap = uploadList.reduce((acc: IUploadFileMap, file) => {
        acc[file.id] = { progress: 0, file: file.instance };
        return acc;
      }, {});
      attachmentManager.upload(uploadList, {
        successCallback: handleSuccess,
        progressCallback: (file, progress) => {
          setUploadingFiles((pre) => ({ ...pre, [file.id]: { progress, file: file.instance } }));
        },
      });
      setUploadingFiles((pre) => ({ ...pre, ...newUploadMap }));
      setTimeout(() => {
        scrollBottom();
      }, 100);
    },
    [handleSuccess]
  );

  const scrollBottom = () => {
    if (listRef.current) {
      const scrollHeight = listRef.current.scrollHeight;
      const height = listRef.current.clientHeight;
      const maxScrollTop = scrollHeight - height;
      listRef.current.scrollTop = maxScrollTop > 0 ? maxScrollTop : 0;
    }
  };

  const len = useMemo(() => {
    return attachments.length + Object.keys(uploadingFiles).length;
  }, [attachments, uploadingFiles]);

  const uploadingFilesList = map(uploadingFiles, (value, key) => ({ id: key, ...value }));

  const [inPageOver, setInPageOver] = useState<boolean>(false);
  const { over } = useDrop();

  useEffect(() => {
    const throttleUpdate = debounce((over: boolean) => {
      setInPageOver(over);
    }, 60);
    throttleUpdate(over);
    return () => throttleUpdate.cancel();
  }, [over]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className={classNames('relative flex-1 overflow-y-scroll', {
          'overflow-y-scroll': !inPageOver,
          'overflow-y-hidden': inPageOver,
        })}
        ref={listRef}
      >
        {(len === 0 || inPageOver) && (
          <DragAndCopy onChange={uploadAttachment} disabled={disabled} />
        )}
        {len > 0 && (
          <ul className="-right-2 w-full h-full flex flex-wrap">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="w-28 h-28 pr-1 mr-1 mb-2 flex flex-col">
                <div className="relative group flex-1 border border-border cursor-pointer rounded-md overflow-hidden">
                  <img
                    className="w-full h-full"
                    src={getFileCover(attachment.mimetype, attachment.url)}
                    alt={attachment.name}
                  />
                  <ul className="absolute top-0 right-0 hidden justify-end group-hover:flex space-x-1 bg-foreground/20 p-1 w-full">
                    {/* <li>
                      <button className="btn btn-xs btn-circle bg-neutral/50 border-none">
                        <FullscreenIcon />
                      </button>
                    </li> */}
                    <li>
                      <Button
                        variant={'ghost'}
                        className="h-5 w-5 rounded-full p-0 focus-visible:ring-transparent focus-visible:ring-offset-0"
                        onClick={() => downloadFile(attachment)}
                      >
                        <Download />
                      </Button>
                    </li>
                    <li>
                      <Button
                        variant={'ghost'}
                        className="h-5 w-5 p-0 rounded-full focus-visible:ring-transparent focus-visible:ring-offset-0"
                        onClick={() => onDelete(attachment.id)}
                        disabled={disabled}
                      >
                        <X />
                      </Button>
                    </li>
                  </ul>
                </div>
                <span
                  className="w-full text-center text-ellipsis whitespace-nowrap overflow-hidden"
                  title={attachment.name}
                >
                  {attachment.name}
                </span>
              </li>
            ))}
            {uploadingFilesList.map(({ id, progress, file }) => (
              <li
                key={id}
                className="w-28 h-28 pr-1 mr-1 flex flex-col justify-between items-center"
              >
                <div className="w-full flex-1 px-2 relative border border-border cursor-pointer rounded-md overflow-hidden flex justify-center items-center flex-col">
                  <Progress value={progress} />
                  {progress}%
                </div>
                <span
                  className="w-full text-center text-ellipsis whitespace-nowrap overflow-hidden"
                  title={file.name}
                >
                  {file.name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!disabled && <FileInput onChange={uploadAttachment} />}
    </div>
  );
};
