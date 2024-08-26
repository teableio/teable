import type { IAttachmentItem, IAttachmentCellValue } from '@teable/core';
import { generateAttachmentId } from '@teable/core';
import { X, Download } from '@teable/icons';
import { UploadType, type INotifyVo } from '@teable/openapi';
import { Button, FilePreviewItem, FilePreviewProvider, Progress, cn } from '@teable/ui-lib';
import { toast } from '@teable/ui-lib/src/shadcn/ui/sonner';
import { map, omit } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { useBaseId } from '../../../../hooks';
import { UsageLimitModalType, useUsageLimitModalStore } from '../../../billing/store';
import { FileZone } from '../../../FileZone';
import { getFileCover, isSystemFileIcon } from '../utils';
import { FileInput } from './FileInput';
import type { IFile } from './uploadManage';
import { AttachmentManager } from './uploadManage';

export interface IUploadAttachment {
  className?: string;
  attachments: IAttachmentCellValue;
  attachmentManager?: AttachmentManager;
  onChange?: (attachment: IAttachmentCellValue | null) => void;
  readonly?: boolean;
}

type IUploadFileMap = { [key: string]: { progress: number; file: File } };

const defaultAttachmentManager = new AttachmentManager(2);

export const UploadAttachment = (props: IUploadAttachment) => {
  const {
    className,
    attachments,
    onChange,
    readonly,
    attachmentManager = defaultAttachmentManager,
  } = props;
  const baseId = useBaseId();
  const [uploadingFiles, setUploadingFiles] = useState<IUploadFileMap>({});
  const listRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<IAttachmentCellValue>(attachments);
  const [newAttachments, setNewAttachments] = useState<IAttachmentCellValue>([]);
  const { t } = useTranslation();
  attachmentsRef.current = attachments;

  useEffect(() => {
    if (newAttachments.length && newAttachments.length === Object.keys(uploadingFiles).length) {
      onChange?.(attachmentsRef.current.concat(newAttachments));
      setNewAttachments([]);
      setUploadingFiles({});
    }
  }, [newAttachments, onChange, uploadingFiles]);

  const onDelete = (id: string) => {
    const finalAttachments = attachments.filter((attachment) => attachment.id !== id);
    onChange?.(!finalAttachments.length ? null : finalAttachments);
  };

  const downloadFile = ({ presignedUrl, name }: IAttachmentItem) => {
    const downloadLink = document.createElement('a');
    downloadLink.href = presignedUrl || '';
    downloadLink.target = '_blank';
    downloadLink.download = name;
    downloadLink.click();
  };

  const handleSuccess = useCallback((file: IFile, attachment: INotifyVo) => {
    const { id, instance } = file;
    const newAttachment: IAttachmentItem = {
      id,
      name: instance.name,
      ...omit(attachment, ['url']),
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
      attachmentManager.upload(
        uploadList,
        UploadType.Table,
        {
          successCallback: handleSuccess,
          errorCallback: (file, error, code) => {
            const curUploadingFiles = { ...uploadingFiles };
            delete curUploadingFiles[file.id];
            setUploadingFiles(curUploadingFiles);

            if (code === 402) {
              return useUsageLimitModalStore.setState({
                modalType: UsageLimitModalType.Upgrade,
                modalOpen: true,
              });
            }
            toast.error(error ?? t('common.uploadFailed'));
          },
          progressCallback: (file, progress) => {
            setUploadingFiles((pre) => ({ ...pre, [file.id]: { progress, file: file.instance } }));
          },
        },
        baseId
      );
      setUploadingFiles((pre) => ({ ...pre, ...newUploadMap }));
      setTimeout(() => {
        scrollBottom();
      }, 100);
    },
    [attachmentManager, baseId, handleSuccess, t, uploadingFiles]
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

  const fileCover = useCallback(({ mimetype, presignedUrl }: IAttachmentItem) => {
    if (!presignedUrl) return '';
    return getFileCover(mimetype, presignedUrl);
  }, []);

  const uploadingFilesList = map(uploadingFiles, (value, key) => ({ id: key, ...value }));

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      <div className="relative flex-1 overflow-y-auto" ref={listRef}>
        <FileZone
          action={['drop', 'paste']}
          defaultText={readonly ? t('common.empty') : t('editor.attachment.uploadDragDefault')}
          onChange={uploadAttachment}
          disabled={readonly}
        >
          {len > 0 && (
            <ul className="-right-2 flex size-full flex-wrap">
              <FilePreviewProvider>
                {attachments.map((attachment) => (
                  <li key={attachment.id} className="mb-2 flex h-32 w-28 flex-col pr-3">
                    <div
                      className={cn(
                        'group relative flex-1 cursor-pointer overflow-hidden rounded-md border border-border',
                        {
                          'border-none': isSystemFileIcon(attachment.mimetype),
                        }
                      )}
                    >
                      <FilePreviewItem
                        className="flex items-center justify-center"
                        src={attachment.presignedUrl || ''}
                        name={attachment.name}
                        mimetype={attachment.mimetype}
                        size={attachment.size}
                      >
                        <img
                          className="size-full object-contain"
                          src={fileCover(attachment)}
                          alt={attachment.name}
                        />
                      </FilePreviewItem>
                      <ul className="absolute right-0 top-0 hidden w-full justify-end space-x-1 bg-black/40 p-1 group-hover:flex">
                        <li>
                          <Button
                            variant={'ghost'}
                            className="size-5 rounded-full p-0 text-white focus-visible:ring-transparent focus-visible:ring-offset-0"
                            onClick={() => downloadFile(attachment)}
                          >
                            <Download />
                          </Button>
                        </li>
                        <li>
                          {!readonly && (
                            <Button
                              variant={'ghost'}
                              className="size-5 rounded-full p-0 text-white focus-visible:ring-transparent focus-visible:ring-offset-0"
                              onClick={() => onDelete(attachment.id)}
                            >
                              <X />
                            </Button>
                          )}
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
                <li key={id} className="mb-2 flex h-32 w-28 flex-col pr-3">
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
        </FileZone>
      </div>
      {!readonly && <FileInput onChange={uploadAttachment} />}
    </div>
  );
};
