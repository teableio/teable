import { X } from '@teable/icons';
import { useLanDayjs } from '@teable/sdk/hooks';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ICollaborator } from './Collaborator';
import { Collaborator } from './Collaborator';

export const CollaboratorItem = (props: {
  item: ICollaborator;
  createdTime: string;
  children: React.ReactNode;
  collaboratorTips?: React.ReactNode;
  onDeleted: () => void;
  deletable?: boolean;
  showDelete?: boolean;
}) => {
  const { item, createdTime, children, onDeleted, deletable, showDelete, collaboratorTips } = props;
  const { t } = useTranslation('common');
  const dayjs = useLanDayjs();
  return (
    <div className="relative flex items-center gap-3 pr-6">
      <Collaborator item={item} tips={collaboratorTips} />
      <div className="text-xs text-muted-foreground">
        {t('invite.dialog.collaboratorJoin', {
          joinTime: dayjs(createdTime).fromNow(),
        })}
      </div>
      {children}
      {showDelete && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="absolute right-0 h-auto p-0 hover:bg-inherit"
                size="sm"
                variant="ghost"
                disabled={!deletable}
                onClick={() => onDeleted()}
              >
                <X className="size-4 cursor-pointer text-muted-foreground opacity-70 hover:opacity-100" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('invite.dialog.collaboratorRemove')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};
