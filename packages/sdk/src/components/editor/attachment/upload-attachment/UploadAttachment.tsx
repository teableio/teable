import type { IAttachmentItem, IAttachmentCellValue } from '@teable-group/core';
import { generateAttachmentId } from '@teable-group/core';
import { X, Download } from '@teable-group/icons';
import type { INotifyVo } from '@teable-group/openapi';
import { Button, FilePreviewItem, FilePreviewProvider, Progress } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { debounce, map } from 'lodash';
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
  const [newAttachments, setNewAttachments] = useState<IAttachmentCellValue>([]);

  attachmentsRef.current = attachments;

  useEffect(() => {
    if (newAttachments.length && newAttachments.length === Object.keys(uploadingFiles).length) {
      onChange(attachmentsRef.current.concat(newAttachments));
      setNewAttachments([]);
      setUploadingFiles({});
    }
  }, [newAttachments, onChange, uploadingFiles]);

  const onDelete = (id: string) => {
    onChange(attachments.filter((attachment) => attachment.id !== id));
  };

  const downloadFile = ({ url, name }: IAttachmentItem) => {
    window.open(`${url}?filename=${name}`);
  };

  const handleSuccess = useCallback((file: IFile, attachment: INotifyVo) => {
    const { id, instance } = file;

    const newAttachment: IAttachmentItem = {
      id,
      name: instance.name,
      ...attachment,
    };
    setNewAttachments((pre) => [...pre, newAttachment]);
  }, []);

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
    <div className="flex h-full flex-col overflow-hidden">
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
          <ul className="-right-2 flex h-full w-full flex-wrap">
            <FilePreviewProvider>
              {attachments.map((attachment) => (
                <li key={attachment.id} className="mb-2 flex h-32 w-28 flex-col pr-3">
                  <div className="group relative flex-1 cursor-pointer overflow-hidden rounded-md border border-border">
                    <FilePreviewItem
                      className="flex items-center justify-center"
                      src={attachment.url}
                      name={attachment.name}
                      mimetype={attachment.mimetype}
                      size={attachment.size}
                    >
                      <img
                        className="h-full w-full object-contain"
                        src={getFileCover(attachment.mimetype, attachment.url)}
                        alt={attachment.name}
                      />
                    </FilePreviewItem>
                    <ul className="absolute right-0 top-0 hidden w-full justify-end space-x-1 bg-foreground/20 p-1 group-hover:flex">
                      {/* <li>
                      <button className="btn btn-xs btn-circle bg-neutral/50 border-none">
                        <FullscreenIcon />
                      </button>
                    </li> */}
                      <li>
                        <Button
                          variant={'ghost'}
                          className="h-5 w-5 rounded-full p-0 text-white focus-visible:ring-transparent focus-visible:ring-offset-0"
                          onClick={() => downloadFile(attachment)}
                        >
                          <Download />
                        </Button>
                      </li>
                      <li>
                        <Button
                          variant={'ghost'}
                          className="h-5 w-5 rounded-full p-0 text-white focus-visible:ring-transparent focus-visible:ring-offset-0"
                          onClick={() => onDelete(attachment.id)}
                          disabled={disabled}
                        >
                          <X />
                        </Button>
                      </li>
                    </ul>
                  </div>
                  <span className="mt-1 w-full truncate text-center" title={attachment.name}>
                    {attachment.name}
                  </span>
                </li>
              ))}
            </FilePreviewProvider>
            {uploadingFilesList.map(({ id, progress, file }) => (
              <li
                key={id}
                className="mb-2 flex h-28 w-1/4 flex-col items-center justify-between pr-1"
              >
                <div className="relative flex w-full flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-md border border-border px-2">
                  <Progress value={progress} />
                  {progress}%
                </div>
                <span className="w-full truncate text-center" title={file.name}>
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
