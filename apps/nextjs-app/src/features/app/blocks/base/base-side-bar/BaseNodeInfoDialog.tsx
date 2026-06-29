import { BaseNodeResourceType, type IBaseNodeResourceMeta } from '@teable/openapi';
import { CollaboratorWithHoverCard } from '@teable/sdk/components';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { CopyButton } from '@/features/app/components/CopyButton';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { tableConfig } from '@/features/i18n/table.config';
import type { TreeItemData } from '../base-node/hooks';
import { BaseNodeResourceIconMap } from '../base-node/hooks';

interface IBaseNodeInfoDialogProps {
  node: TreeItemData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type IBaseNodeResourceMetaUser = NonNullable<IBaseNodeResourceMeta['createdByUser']>;

const EmptyValue = '-';

const UserProfile = ({ user }: { user?: IBaseNodeResourceMetaUser | null }) => {
  if (!user) {
    return <span className="text-muted-foreground">{EmptyValue}</span>;
  }

  return (
    <CollaboratorWithHoverCard
      id={user.id}
      name={user.name}
      avatar={user.avatar}
      email={user.email ?? ''}
    >
      <span className="inline-flex min-w-0 max-w-full items-center gap-2 align-top">
        <UserAvatar user={user} className="size-7 shrink-0 border" />
        <span className="min-w-0 truncate text-sm font-medium" title={user.email ?? undefined}>
          {user.name}
        </span>
      </span>
    </CollaboratorWithHoverCard>
  );
};

const InfoCard = ({
  userLabel,
  timeLabel,
  user,
  time,
}: {
  userLabel: string;
  timeLabel: string;
  user?: IBaseNodeResourceMetaUser | null;
  time: string;
}) => {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-md border p-4 text-sm">
      <div className="space-y-2">
        <div className="text-muted-foreground">{userLabel}</div>
        <UserProfile user={user} />
      </div>
      <div className="space-y-2">
        <div className="text-muted-foreground">{timeLabel}</div>
        <div className="truncate font-medium" title={time}>
          {time}
        </div>
      </div>
    </div>
  );
};

const ResourceSummary = ({ node }: { node: TreeItemData }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const resourceId = node.resourceId || EmptyValue;
  const IconComponent = BaseNodeResourceIconMap[node.resourceType];
  const resourceIdLabel = (() => {
    switch (node.resourceType) {
      case BaseNodeResourceType.Folder:
        return t('table:baseNode.info.folderId');
      case BaseNodeResourceType.Table:
        return t('table:baseNode.info.tableId');
      case BaseNodeResourceType.Workflow:
        return t('table:baseNode.info.automationId');
      case BaseNodeResourceType.App:
        return t('table:baseNode.info.appId');
      default:
        return 'ID';
    }
  })();

  return (
    <div className="min-w-0 space-y-2 overflow-hidden rounded-md border bg-muted p-4">
      <div className="flex min-w-0 items-center gap-2 font-medium">
        {IconComponent && <IconComponent className="size-4 shrink-0" />}
        <span className="min-w-0 truncate" title={node.resourceMeta.name}>
          {node.resourceMeta.name || EmptyValue}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-4 text-sm">
        <div className="shrink-0 text-muted-foreground">{resourceIdLabel}</div>
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 max-w-full truncate" title={resourceId}>
            {resourceId}
          </div>
          <CopyButton
            text={node.resourceId}
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            iconClassName="size-4"
            disabled={!node.resourceId}
          />
        </div>
      </div>
    </div>
  );
};

const InfoSection = ({ node }: { node: TreeItemData }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const dayjs = useLanDayjs();
  const { resourceMeta } = node;
  const formatTime = (value?: string | null) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : EmptyValue;
  const shouldShowLastModified = Boolean(resourceMeta.lastModifiedByUser);

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-hidden">
      <ResourceSummary node={node} />
      <div className="flex min-w-0 max-w-full flex-col gap-4 sm:flex-row">
        <InfoCard
          userLabel={t('table:baseNode.info.createdBy')}
          timeLabel={t('table:baseNode.info.createdTime')}
          user={resourceMeta.createdByUser}
          time={formatTime(resourceMeta.createdTime)}
        />
        {shouldShowLastModified && (
          <InfoCard
            userLabel={t('table:baseNode.info.lastModifiedBy')}
            timeLabel={t('table:baseNode.info.lastModifiedTime')}
            user={resourceMeta.lastModifiedByUser}
            time={formatTime(resourceMeta.lastModifiedTime)}
          />
        )}
      </div>
    </div>
  );
};

export const BaseNodeInfoDialog = (props: IBaseNodeInfoDialogProps) => {
  const { node, open, onOpenChange } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw_-_32px)] max-w-[480px] overflow-hidden rounded-lg">
        <DialogHeader className="min-w-0 overflow-hidden">
          <DialogTitle className="flex min-w-0 max-w-full overflow-hidden pr-6">
            <span className="min-w-0 flex-1 truncate">{t('table:baseNode.info.menu')}</span>
          </DialogTitle>
        </DialogHeader>
        <InfoSection node={node} />
      </DialogContent>
    </Dialog>
  );
};
