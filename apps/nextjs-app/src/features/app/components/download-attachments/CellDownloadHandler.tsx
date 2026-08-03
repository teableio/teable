'use client';

import { sonner } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import type { IDownloadProgress } from '../../utils/download-all-attachments';
import {
  downloadCellAttachments,
  downloadSingleAttachment,
  isStreamingDownloadAvailable,
} from '../../utils/download-all-attachments';
import { DownloadProgressToast } from '../DownloadProgressToast';
import { useDownloadAttachmentsStore } from './useDownloadAttachmentsStore';

const { toast } = sonner;

/**
 * Handler component that listens to cell download signals and performs the download
 * Should be placed at a high level in the component tree (e.g., Table.tsx)
 */
export const CellDownloadHandler = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const cellDownload = useDownloadAttachmentsStore((state) => state.cellDownload);
  const clearCellDownload = useDownloadAttachmentsStore((state) => state.clearCellDownload);
  const processingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleDownload = useCallback(async () => {
    const { attachments, zipFileName } = cellDownload;
    if (!attachments || attachments.length === 0 || processingRef.current) return;

    processingRef.current = true;
    clearCellDownload();

    try {
      // Single attachment - download directly
      if (attachments.length === 1) {
        downloadSingleAttachment(attachments[0]);
        return;
      }

      // Multiple attachments - check streaming support
      if (!isStreamingDownloadAvailable()) {
        toast.error(t('sdk:editor.attachment.requireHttps'));
        return;
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Calculate total size for progress
      const totalSize = attachments.reduce((sum, a) => sum + (a.size || 0), 0);

      const toastId = toast.custom(
        () => (
          <DownloadProgressToast
            progress={{ downloaded: 0, total: totalSize, currentFileName: '', percent: 0 }}
            onCancel={() => {
              abortController.abort();
              toast.dismiss(toastId);
            }}
          />
        ),
        { duration: Infinity, unstyled: true, classNames: { toast: 'bg-transparent shadow-none' } }
      );

      const updateProgress = (progress: IDownloadProgress) => {
        toast.custom(
          () => (
            <DownloadProgressToast
              progress={progress}
              onCancel={() => {
                abortController.abort();
                toast.dismiss(toastId);
              }}
            />
          ),
          {
            id: toastId,
            duration: Infinity,
            unstyled: true,
            classNames: { toast: 'bg-transparent shadow-none border rounded-lg' },
          }
        );
      };

      const result = await downloadCellAttachments({
        attachments,
        zipFileName: zipFileName || 'attachments.zip',
        onProgress: updateProgress,
        abortController,
      });

      toast.dismiss(toastId);

      if (result.cancelled) {
        toast.info(t('sdk:editor.attachment.downloadCancelled'));
        return;
      }

      if (result.success) {
        toast.success(t('sdk:editor.attachment.downloadSuccess'));
      } else if (result.failedFiles.length > 0) {
        toast.warning(
          `${t('sdk:editor.attachment.downloadFailed')}: ${result.failedFiles.slice(0, 3).join(', ')}${result.failedFiles.length > 3 ? '...' : ''}`
        );
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        toast.error(t('sdk:editor.attachment.downloadFailed'));
      }
    } finally {
      processingRef.current = false;
      abortControllerRef.current = null;
    }
  }, [cellDownload, clearCellDownload, t]);

  useEffect(() => {
    if (cellDownload.attachments && cellDownload.attachments.length > 0) {
      handleDownload();
    }
  }, [cellDownload, handleDownload]);

  return null;
};
