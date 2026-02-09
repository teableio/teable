import { UsageLimitModalType, useUsageLimitModalStore } from '@teable/sdk/components/billing/store';
import { EllipsisFileName } from '@teable/sdk/components/upload/EllipsisFileName';
import { FileCover } from '@teable/sdk/components/upload/FileCover';
import type { IGlobalUploadTask } from '@teable/sdk/store/use-attachment-upload-store';
import { cn, isImage } from '@teable/ui-lib';
import { RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';

interface ITaskItemProps {
  task: IGlobalUploadTask;
  onCancel: () => void;
  onRemove: () => void;
  onRetry: () => void;
}

export const TaskItem = ({ task, onCancel, onRemove, onRetry }: ITaskItemProps) => {
  const { t } = useTranslation('table');
  const mimetype = task.file.type || 'application/octet-stream';
  const isError = task.status === 'error';
  const isCompleted = task.status === 'completed';
  const isUploading = task.status === 'uploading' || task.status === 'pending';
  const shouldShowRemove = isError || isCompleted;
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  console.log('isUploading', isUploading);
  // Use ref to avoid resetting timers when parent re-renders with new callback references
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;

  useEffect(() => {
    if (!isImage(mimetype)) {
      setImageUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(task.file);
    setImageUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [mimetype, task.file]);

  useEffect(() => {
    if (task.code === 402) {
      useUsageLimitModalStore.setState({
        modalType: UsageLimitModalType.Upgrade,
        modalOpen: true,
      });
    }
  }, [task.code, task.error, t]);

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 w-full overflow-hidden'
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
        <FileCover
          className="size-full object-cover"
          mimetype={mimetype}
          url={imageUrl}
          name={task.fileName}
        />
      </div>

      <div className="flex-1 overflow-hidden">
        <EllipsisFileName className="justify-start" name={task.fileName} />

        <div className="mt-0.5 flex items-center gap-1.5">
          {isUploading ? (
            <span className="text-[11px] text-primary">{task.progress}%</span>
          ) : isError ? (
            <span className="text-[11px] text-destructive">
              {task.error || t('upload.statusFailed')}
            </span>
          ) : (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-500">
              {t('upload.statusCompleted')}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {isError ? (
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded transition-colors hover:bg-muted/50"
            onClick={onRetry}
            title={t('upload.statusRetry')}
          >
            <RotateCcw className="size-3.5 text-muted-foreground" />
          </button>
        ) : null}
        {isUploading ? (
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded transition-colors hover:bg-muted/50"
            onClick={onCancel}
            title={t('upload.statusCancel')}
          >
            <X className="size-3.5 text-muted-foreground" />
          </button>
        ) : null}
        {shouldShowRemove ? (
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded transition-colors hover:bg-muted/50"
            onClick={onRemove}
          >
            <X className="size-3.5 text-muted-foreground" />
          </button>
        ) : null}
      </div>
    </div>
  );
};
