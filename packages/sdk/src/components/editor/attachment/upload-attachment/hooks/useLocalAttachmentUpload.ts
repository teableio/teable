import type { IAttachmentItem, IAttachmentCellValue } from '@teable/core';
import { generateAttachmentId } from '@teable/core';
import { UploadType, type INotifyVo } from '@teable/openapi';
import { sonner } from '@teable/ui-lib';
import { omit } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../../../../context/app/i18n';
import { UsageLimitModalType, useUsageLimitModalStore } from '../../../../billing/store';
import type { IUploadingFile } from '../types';
import type { IFile, AttachmentManager } from '../uploadManage';

const { toast } = sonner;

interface UseLocalAttachmentUploadParams {
  attachments: IAttachmentCellValue;
  onChange?: (attachment: IAttachmentCellValue | null) => void;
  attachmentManager: AttachmentManager;
  baseId?: string;
}

interface UseLocalAttachmentUploadReturn {
  uploadingFiles: IUploadingFile[];
  onUpload: (files: File[]) => void;
  onCancelUpload: (id: string) => void;
  setUploadingFiles: React.Dispatch<React.SetStateAction<IUploadingFile[]>>;
}

export const useLocalAttachmentUpload = (
  params: UseLocalAttachmentUploadParams
): UseLocalAttachmentUploadReturn => {
  const { attachments, onChange, attachmentManager, baseId } = params;
  const [uploadingFiles, setUploadingFiles] = useState<IUploadingFile[]>([]);
  const attachmentsRef = useRef(attachments);
  const { t } = useTranslation();

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const onUpload = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const uploadList = files.map((file) => ({
        instance: file,
        id: generateAttachmentId(),
      }));

      const newUploadingFiles: IUploadingFile[] = uploadList.map(({ id, instance }) => ({
        id,
        file: instance,
        progress: 0,
      }));

      setUploadingFiles((prev) => [...prev, ...newUploadingFiles]);

      const batchResult = {
        completed: [] as IAttachmentItem[],
        pending: uploadList.length,
      };

      const commitBatch = () => {
        if (batchResult.completed.length > 0) {
          onChange?.([
            ...attachmentsRef.current,
            ...batchResult.completed.sort(
              (a, b) =>
                uploadList.findIndex((item) => item.id === a.id) -
                uploadList.findIndex((item) => item.id === b.id)
            ),
          ]);
          const uploadedIds = batchResult.completed.map((item) => item.id);
          requestAnimationFrame(() => {
            setUploadingFiles((prev) => prev.filter((item) => !uploadedIds.includes(item.id)));
          });
          batchResult.completed = [];
        }
      };

      const handleSuccess = (file: IFile, attachment: INotifyVo) => {
        const { id, instance } = file;
        const newAttachment: IAttachmentItem = {
          id,
          name: instance.name,
          ...omit(attachment, ['url']),
        };

        batchResult.completed.push(newAttachment);
        batchResult.pending--;
        if (batchResult.pending === 0) {
          commitBatch();
        }
      };

      const handleError = (file: IFile, error?: string, code?: number) => {
        batchResult.pending--;
        if (code === 402) {
          useUsageLimitModalStore.setState({
            modalType: UsageLimitModalType.Upgrade,
            modalOpen: true,
          });
        } else {
          toast.error(error ?? t('common.uploadFailed'));
        }
        if (batchResult.pending === 0) {
          commitBatch();
        }
        requestAnimationFrame(() => {
          setUploadingFiles((prev) => prev.filter((item) => item.id !== file.id));
        });
      };

      attachmentManager.upload(
        uploadList,
        UploadType.Table,
        {
          successCallback: handleSuccess,
          errorCallback: handleError,
          progressCallback: (file, progress) => {
            setUploadingFiles((prev) =>
              prev.map((item) => (item.id === file.id ? { ...item, progress } : item))
            );
          },
        },
        baseId
      );
    },
    [attachmentManager, baseId, onChange, t]
  );

  const onCancelUpload = useCallback(
    (id: string) => {
      attachmentManager.cancelTask(id);
      setUploadingFiles((prev) => prev.filter((item) => item.id !== id));
    },
    [attachmentManager]
  );

  return { uploadingFiles, onUpload, onCancelUpload, setUploadingFiles };
};
