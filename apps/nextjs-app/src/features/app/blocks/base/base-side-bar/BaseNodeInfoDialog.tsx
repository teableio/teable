import { useQuery } from '@tanstack/react-query';
import {
  BaseNodeResourceType,
  getTableSearchVectorStatus,
  type IBaseNodeResourceMeta,
  type ITableSearchVectorStatusVo,
} from '@teable/openapi';
import { CollaboratorWithHoverCard } from '@teable/sdk/components';
import { useBaseId, useLanDayjs } from '@teable/sdk/hooks';
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

const ResourceSummary = ({
  node,
  searchVectorStatus,
}: {
  node: TreeItemData;
  searchVectorStatus?: ITableSearchVectorStatusVo;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const searchVectorStatusText = (() => {
    switch (searchVectorStatus?.state) {
      case 'ready':
        return searchVectorStatus?.active
          ? t('table:baseNode.info.searchVectorStatus.ready', { defaultValue: 'Enabled' })
          : t('table:baseNode.info.searchVectorStatus.configured', {
              defaultValue: 'Configured',
            });
      case 'rebuild_pending':
        return t('table:baseNode.info.searchVectorStatus.rebuildPending', {
          defaultValue: 'Maintenance pending',
        });
      case 'stale':
        return t('table:baseNode.info.searchVectorStatus.stale', {
          defaultValue: 'Needs rebuild',
        });
      default:
        return t('table:baseNode.info.searchVectorStatus.unknown', { defaultValue: 'Unknown' });
    }
  })();
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
      {searchVectorStatus && searchVectorStatus.state !== 'disabled' && (
        <div className="flex min-w-0 items-center justify-between gap-3 border-t pt-3 text-sm">
          <span className="text-muted-foreground">
            {t('table:baseNode.info.searchVector', { defaultValue: 'Full-text search' })}
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded border bg-background px-2 py-0.5 text-xs font-medium">
              {searchVectorStatusText}
            </span>
            {searchVectorStatus.languageConfig && (
              <span className="truncate text-xs text-muted-foreground">
                {searchVectorStatus.languageConfig} · {searchVectorStatus.coveredFieldCount}{' '}
                {t('table:baseNode.info.searchVectorFields', { defaultValue: 'fields' })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const InfoSection = ({
  node,
  searchVectorStatus,
}: {
  node: TreeItemData;
  searchVectorStatus?: ITableSearchVectorStatusVo;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const dayjs = useLanDayjs();
  const { resourceMeta } = node;
  const formatTime = (value?: string | null) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : EmptyValue;
  const shouldShowLastModified = Boolean(resourceMeta.lastModifiedByUser);

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-hidden">
      <ResourceSummary node={node} searchVectorStatus={searchVectorStatus} />
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
  const baseId = useBaseId();
  const tableId = node.resourceType === BaseNodeResourceType.Table ? node.resourceId : undefined;
  const { data: searchVectorStatus } = useQuery({
    queryKey: ['table-search-vector-status', baseId, tableId],
    queryFn: () => getTableSearchVectorStatus(baseId!, tableId!).then(({ data }) => data),
    enabled: Boolean(open && baseId && tableId),
    retry: false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw_-_32px)] max-w-[480px] overflow-hidden rounded-lg">
        <DialogHeader className="min-w-0 overflow-hidden">
          <DialogTitle className="flex min-w-0 max-w-full overflow-hidden pr-6">
            <span className="min-w-0 flex-1 truncate">{t('table:baseNode.info.menu')}</span>
          </DialogTitle>
        </DialogHeader>
        <InfoSection node={node} searchVectorStatus={searchVectorStatus} />
      </DialogContent>
    </Dialog>
  );
};
