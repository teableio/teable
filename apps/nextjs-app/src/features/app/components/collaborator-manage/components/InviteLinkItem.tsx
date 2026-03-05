import { Copy, Trash2 } from '@teable/icons';
import { useLanDayjs } from '@teable/sdk/hooks';
import { syncCopy } from '@teable/sdk/utils';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';

export const InviteLinkItem = (props: {
  url: string;
  createdTime: string;
  deleteDisabled?: boolean;
  onDelete: () => void;
  children: React.ReactNode;
}) => {
  const { url, createdTime, children, deleteDisabled, onDelete } = props;
  const { t } = useTranslation('common');
  const dayjs = useLanDayjs();

  const copyInviteUrl = async () => {
    syncCopy(url);
    toast.success(t('invite.dialog.linkCopySuccess'));
  };

  return (
    <div className="flex items-center gap-2 overflow-hidden">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{url}</div>
        <div className="text-xs text-muted-foreground">
          {dayjs(createdTime).format('YYYY-MM-DD')}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
      <div className="flex shrink-0 items-center gap-0">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={copyInviteUrl}>
                <Copy className="size-4 cursor-pointer text-muted-foreground opacity-70 hover:opacity-100" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('actions.copyLink')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" disabled={deleteDisabled} onClick={onDelete}>
                <Trash2 className="size-4 cursor-pointer text-muted-foreground opacity-70 hover:opacity-100" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('invite.dialog.linkRemove')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};
