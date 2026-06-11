'use client';

import { useCellAttachmentUploadStore } from '@teable/sdk/store/use-attachment-upload-store';
import { cn } from '@teable/ui-lib';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useTranslation } from 'next-i18next';

interface IUploadProgressBubbleProps {
  isExpanded: boolean;
  onToggle: () => void;
  onClose: () => void;
}

const CIRCLE_RADIUS = 8;
const CIRCLE_LENGTH = 2 * Math.PI * CIRCLE_RADIUS;

export const UploadProgressBubble = ({
  isExpanded,
  onToggle,
  onClose,
}: IUploadProgressBubbleProps) => {
  const { t } = useTranslation('table');
  const globalProgress = useCellAttachmentUploadStore((state) => state.getGlobalProgress());

  const { total, uploading, failed, progress } = globalProgress;
  const hasActiveUploads = uploading > 0;
  const hasErrors = failed > 0 && !hasActiveUploads;
  const hasTasks = total > 0;
  const statusText = hasActiveUploads
    ? t('upload.panelUploading', { count: uploading })
    : hasErrors
      ? t('upload.panelFailed', { count: failed })
      : t('upload.panelCompleted', { count: globalProgress.completed });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        'flex cursor-pointer select-none items-center justify-between px-3 py-2.5',
        'transition-colors hover:bg-muted/30',
        hasActiveUploads && 'border-primary/20',
        hasErrors && 'border-destructive/20',
        !hasActiveUploads && !hasErrors && 'border-border/50'
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative flex size-5 items-center justify-center">
          {hasActiveUploads ? (
            <>
              <div className="-rotate-90">
                <svg className="size-5" viewBox="0 0 20 20">
                  <circle
                    cx="10"
                    cy="10"
                    r={CIRCLE_RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-muted-foreground/30"
                  />
                  <circle
                    cx="10"
                    cy="10"
                    r={CIRCLE_RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={`${(progress / 100) * CIRCLE_LENGTH} ${CIRCLE_LENGTH}`}
                    className="text-primary transition-all duration-300"
                  />
                </svg>
              </div>
              <span className="absolute text-[8px] font-medium text-muted-foreground">
                {progress}
              </span>
            </>
          ) : hasErrors ? (
            <AlertCircle className="size-5 text-destructive" />
          ) : (
            <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-500" />
          )}
        </div>
        <span className="text-[13px] font-medium text-foreground">
          {hasTasks ? statusText : t('upload.panelCompleted', { count: 0 })}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded transition-colors hover:bg-muted/50"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="size-4 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded transition-colors hover:bg-muted/50"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
};
