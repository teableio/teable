import type { IGetRecordsRo } from '@teable/openapi';
import { Button, Skeleton } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import type { IAttachmentPreview, IDownloadProgress } from '../../utils/download-all-attachments';
import {
  downloadAllAttachments,
  formatFileSize,
  getAttachmentPreview,
} from '../../utils/download-all-attachments';
import { DownloadProgressToast } from '../DownloadProgressToast';

interface IDownloadContentProps {
  tableId: string;
  fieldId: string;
  fieldName: string;
  viewId?: string;
  shareId?: string;
  personalViewCommonQuery?: IGetRecordsRo;
  onClose: () => void;
}

export const DownloadContent = ({
  tableId,
  fieldId,
  fieldName,
  viewId,
  shareId,
  personalViewCommonQuery,
  onClose,
}: IDownloadContentProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<IAttachmentPreview | null>(null);
  const [downloading, setDownloading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load preview on mount
  useEffect(() => {
    const loadPreview = async () => {
      try {
        const previewData = await getAttachmentPreview(
          tableId,
          fieldId,
          viewId,
          shareId,
          personalViewCommonQuery
        );
        setPreview(previewData);
      } catch (error) {
        console.error('Failed to load preview:', error);
        onClose();
        toast.error(t('table:download.allAttachments.error'));
      } finally {
        setLoading(false);
      }
    };

    loadPreview();
  }, [tableId, fieldId, viewId, shareId, personalViewCommonQuery, onClose, t]);

  const handleStartDownload = useCallback(async () => {
    if (!preview || preview.totalAttachments === 0) return;

    // Check if Service Worker is available (requires HTTPS or localhost)
    if (typeof window !== 'undefined' && !navigator.serviceWorker) {
      toast.error(t('table:download.allAttachments.requireHttps'));
      return;
    }

    setDownloading(true);
    onClose();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const toastId = toast.custom(
      () => (
        <DownloadProgressToast
          progress={{ downloaded: 0, total: 0, currentFileName: '', percent: 0 }}
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

    try {
      updateProgress({
        downloaded: 0,
        total: preview.totalSize,
        currentFileName: '',
        percent: 0,
      });

      const result = await downloadAllAttachments({
        tableId,
        fieldId,
        fieldName,
        viewId,
        shareId,
        personalViewCommonQuery,
        abortController,
        onProgress: updateProgress,
      });

      toast.dismiss(toastId);

      if (result.cancelled) {
        toast.info(t('table:download.allAttachments.cancelled'));
      } else if (result.success) {
        toast.success(t('table:download.allAttachments.completed'));
      } else if (result.failedFiles.length > 0) {
        toast.warning(
          t('table:download.allAttachments.errorPartial', {
            failedCount: result.failedFiles.length,
          })
        );
      }
    } catch (error) {
      toast.dismiss(toastId);
      console.error('Download failed:', error);
      toast.error(t('table:download.allAttachments.error'));
    } finally {
      setDownloading(false);
      abortControllerRef.current = null;
    }
  }, [preview, tableId, fieldId, fieldName, viewId, shareId, personalViewCommonQuery, onClose, t]);

  if (loading) {
    return (
      <>
        <div className="flex flex-col gap-3 py-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('table:download.allAttachments.cancel')}
          </Button>
          <Button disabled>{t('table:download.allAttachments.startDownload')}</Button>
        </div>
      </>
    );
  }

  if (!preview || preview.totalAttachments === 0) {
    return (
      <>
        <div className="py-4">
          <p className="text-muted-foreground">
            {t('table:download.allAttachments.noAttachments')}
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('table:download.allAttachments.cancel')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 py-4">
        <p className="text-sm">
          {t('table:download.allAttachments.rowsWithAttachments', {
            count: preview.rowsWithAttachments,
          })}
        </p>
        <p className="text-sm">
          {t('table:download.allAttachments.totalAttachments', {
            count: preview.totalAttachments,
          })}
        </p>
        <p className="text-sm font-medium">
          {t('table:download.allAttachments.totalSize', {
            size: formatFileSize(preview.totalSize),
          })}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={downloading}>
          {t('table:download.allAttachments.cancel')}
        </Button>
        <Button onClick={handleStartDownload} disabled={downloading}>
          {t('table:download.allAttachments.startDownload')}
        </Button>
      </div>
    </>
  );
};
