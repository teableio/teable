import { UsageLimitModalType, useUsageLimitModalStore } from '@teable/sdk/components/billing/store';
import { EllipsisFileName } from '@teable/sdk/components/upload/EllipsisFileName';
import { FileCover } from '@teable/sdk/components/upload/FileCover';
import type { IGlobalUploadTask } from '@teable/sdk/store/use-attachment-upload-store';
import { cn, isImage } from '@teable/ui-lib';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

interface ITaskItemProps {
  task: IGlobalUploadTask;
  onCancel: () => void;
  onRemove: () => void;
  onRetry: () => void;
}

const UploadActionButton = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={onClick}
            aria-label={label}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>{label}</TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};

export const TaskItem = ({ task, onCancel, onRemove, onRetry }: ITaskItemProps) => {
  const { t } = useTranslation(['table', 'common']);
  const mimetype = task.file.type || 'application/octet-stream';
  const isError = task.status === 'error';
  const isCompleted = task.status === 'completed';
  const isUploading = task.status === 'uploading' || task.status === 'pending';
  const shouldShowRemove = isError || isCompleted;
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
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

  const completedPreviewUrl =
    task.attachmentItem?.lgThumbnailUrl ??
    task.attachmentItem?.smThumbnailUrl ??
    (isImage(mimetype) ? task.attachmentItem?.presignedUrl : undefined);
  const previewUrl = isCompleted ? completedPreviewUrl ?? imageUrl : imageUrl;
  const shouldRenderPreviewImage = Boolean(
    previewUrl && (isImage(mimetype) || completedPreviewUrl)
  );

  return (
    <div
      className={cn(
        'group relative flex w-full items-center gap-3 overflow-hidden px-4 py-2.5 hover:bg-accent dark:hover:bg-[#303132]'
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
        {shouldRenderPreviewImage ? (
          <img className="size-full object-cover" src={previewUrl} alt={task.fileName} />
        ) : (
          <FileCover
            className="size-full object-cover"
            mimetype={mimetype}
            url={previewUrl}
            name={task.fileName}
          />
        )}
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        <EllipsisFileName className="justify-start" name={task.fileName} />

        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {isUploading ? (
            <span className="text-[11px] text-primary">{task.progress}%</span>
          ) : isError ? (
            <span className="min-w-0 whitespace-normal break-words text-[11px] leading-4 text-destructive [overflow-wrap:anywhere]">
              {task.error || t('upload.statusFailed')}
            </span>
          ) : (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-500">
              {t('upload.statusCompleted')}
            </span>
          )}
        </div>
      </div>

      <div className="absolute right-0 top-0 z-10 hidden h-full items-center group-focus-within:flex group-hover:flex">
        <div className="h-full w-8 bg-gradient-to-r from-accent/0 to-accent dark:from-[#303132]/0 dark:to-[#303132]" />
        <div className="flex h-full items-center gap-1 bg-accent px-2 py-1 dark:bg-[#303132]">
          {isError ? (
            <UploadActionButton label={t('upload.statusRetry')} onClick={onRetry}>
              <RotateCcw className="size-4" />
            </UploadActionButton>
          ) : null}
          {isUploading ? (
            <UploadActionButton label={t('upload.statusCancel')} onClick={onCancel}>
              <X className="size-4" />
            </UploadActionButton>
          ) : null}
          {shouldShowRemove ? (
            <UploadActionButton label={t('common:actions.clear')} onClick={onRemove}>
              <X className="size-4" />
            </UploadActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
};
