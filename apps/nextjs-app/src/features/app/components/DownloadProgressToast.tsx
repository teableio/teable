import { X } from '@teable/icons';
import { Button, Progress } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import type { IDownloadProgress } from '../utils/download-all-attachments';
import { formatFileSize } from '../utils/download-all-attachments';

interface IDownloadProgressToastProps {
  progress: IDownloadProgress;
  onCancel: () => void;
}

export const DownloadProgressToast = ({ progress, onCancel }: IDownloadProgressToastProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { downloaded, total, currentFileName, percent } = progress;

  return (
    <div className="flex w-[340px] flex-col gap-3 rounded-lg bg-transparent p-4 text-popover-foreground transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-1 flex-col gap-1 overflow-hidden">
          <span className="text-sm font-semibold leading-none tracking-tight">
            {t('table:download.allAttachments.downloading')}
          </span>
          <p className="truncate text-xs text-muted-foreground" title={currentFileName}>
            {currentFileName || '\u00A0'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          className="-mr-1 -mt-1 size-6 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Progress value={percent} className="h-2" />
        <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
          <span>
            {formatFileSize(downloaded)} / {formatFileSize(total)}
          </span>
          <span className="font-medium text-foreground">{percent}%</span>
        </div>
      </div>
    </div>
  );
};
