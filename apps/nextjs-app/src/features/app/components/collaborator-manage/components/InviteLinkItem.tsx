import { Copy, X } from '@teable/icons';
import { useLanDayjs } from '@teable/sdk/hooks';
import { syncCopy } from '@teable/sdk/utils';
import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

export const InviteLinkItem = (props: {
  url: string;
  createdTime: string;
  deleteDisabled?: boolean;
  onDelete: () => void;
  children: React.ReactNode;
}) => {
  const { url, createdTime, children, deleteDisabled, onDelete } = props;
  const { toast } = useToast();
  const { t } = useTranslation('common');
  const dayjs = useLanDayjs();

  const copyInviteUrl = async () => {
    syncCopy(url);
    toast({ title: t('invite.dialog.linkCopySuccess') });
  };

  return (
    <div className="relative flex items-center gap-3 pr-7">
      <div className="flex flex-1 items-center gap-2">
        <Input className="h-8 flex-1" value={url} readOnly />
        <Copy
          onClick={copyInviteUrl}
          className="size-4 cursor-pointer text-muted-foreground opacity-70 hover:opacity-100"
        />
      </div>
      <div className="text-xs text-muted-foreground">
        {t('invite.dialog.linkCreatedTime', { createdTime: dayjs(createdTime).fromNow() })}
      </div>
      {children}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="absolute right-0 h-auto p-0 hover:bg-inherit"
              size="sm"
              variant="ghost"
              disabled={deleteDisabled}
              onClick={onDelete}
            >
              <X className="size-4 cursor-pointer text-muted-foreground opacity-70 hover:opacity-100" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('invite.dialog.linkRemove')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};
