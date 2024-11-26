import type { QueryFunctionContext } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, RefreshCcw, Trash2 } from '@teable/icons';
import type { ITrashItemVo, ITrashVo } from '@teable/openapi';
import {
  getTrash,
  ResourceType,
  restoreTrash,
  permanentDeleteBase,
  permanentDeleteSpace,
} from '@teable/openapi';
import { InfiniteTable } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsHydrated } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { Collaborator } from '../../components/collaborator-manage/components/Collaborator';

export const SpaceTrashPage = () => {
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const queryClient = useQueryClient();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const [resourceType, setResourceType] = useState<ResourceType.Space | ResourceType.Base>(
    ResourceType.Space
  );
  const [userMap, setUserMap] = useState<ITrashVo['userMap']>({});
  const [resourceMap, setResourceMap] = useState<ITrashVo['resourceMap']>({});
  const [nextCursor, setNextCursor] = useState<string | null | undefined>();
  const [isConfirmVisible, setConfirmVisible] = useState(false);
  const [deletingResource, setDeletingResource] = useState<
    | { resourceId: string; resourceType: ResourceType.Space | ResourceType.Base; name: string }
    | undefined
  >();

  const queryFn = async ({ queryKey }: QueryFunctionContext) => {
    const res = await getTrash({
      resourceType: queryKey[1] as ResourceType.Space | ResourceType.Base,
    });
    const { trashItems, nextCursor } = res.data;

    setNextCursor(() => nextCursor);
    setUserMap({ ...userMap, ...res.data.userMap });
    setResourceMap({ ...resourceMap, ...res.data.resourceMap });

    return trashItems;
  };

  const { data, isFetching, isLoading, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getSpaceTrash(resourceType),
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    getNextPageParam: () => nextCursor,
  });

  const { mutateAsync: mutateRestore } = useMutation({
    mutationFn: (props: { trashId: string }) => restoreTrash(props.trashId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.spaceList());
      queryClient.invalidateQueries(ReactQueryKeys.getSpaceTrash(resourceType));
      toast.success(t('actions.restoreSucceed'));
    },
  });

  const { mutateAsync: mutatePermanentDeleteSpace } = useMutation({
    mutationFn: (props: { spaceId: string }) => permanentDeleteSpace(props.spaceId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getSpaceTrash(resourceType));
      toast.success(t('actions.deleteSucceed'));
    },
  });

  const { mutateAsync: mutatePermanentDeleteBase } = useMutation({
    mutationFn: (props: { baseId: string }) => permanentDeleteBase(props.baseId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getSpaceTrash(resourceType));
      toast.success(t('actions.deleteSucceed'));
    },
  });

  const allRows = useMemo(() => (data ? data.pages.flatMap((d) => d) : []), [data]);

  const columns: ColumnDef<ITrashItemVo>[] = useMemo(() => {
    const tableColumns: ColumnDef<ITrashItemVo>[] = [
      {
        accessorKey: 'resourceId',
        header: t('name'),
        size: Number.MAX_SAFE_INTEGER,
        minSize: 300,
        cell: ({ row }) => {
          const resourceId = row.getValue<string>('resourceId');
          const resourceInfo = resourceMap[resourceId];

          if (!resourceInfo) return null;

          const { name } = resourceInfo;

          if ('spaceId' in resourceInfo) {
            const spaceId = resourceInfo.spaceId;
            const spaceInfo = resourceMap[spaceId];

            return (
              <div className="flex items-center space-x-2 pr-2 text-sm">
                <span>{name}</span>
                <Button
                  className="text-xs"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    router.push({
                      pathname: '/space/[spaceId]',
                      query: { spaceId },
                    });
                  }}
                >
                  <span className="max-w-40 truncate text-xs">
                    {t('trash.fromSpace', { name: spaceInfo.name })}
                  </span>
                </Button>
              </div>
            );
          }

          return <div className="text-wrap pr-2 text-sm">{name}</div>;
        },
      },
      {
        accessorKey: 'deletedBy',
        header: t('trash.deletedBy'),
        size: 220,
        cell: ({ row }) => {
          const createdBy = row.getValue<string>('deletedBy');
          const user = userMap[createdBy];

          if (!user) return null;

          const { name, avatar, email } = user;

          return <Collaborator name={name} email={email} avatar={avatar} />;
        },
      },
      {
        accessorKey: 'deletedTime',
        header: t('trash.deletedTime'),
        size: 220,
        cell: ({ row }) => {
          const deletedTime = row.getValue<string>('deletedTime');
          const deletedDateStr = dayjs(deletedTime).format('YYYY/MM/DD HH:mm');
          return <div title={deletedDateStr}>{deletedDateStr}</div>;
        },
      },
      {
        id: 'actions',
        header: t('actions.title'),
        size: 80,
        cell: ({ row }) => {
          const { id: trashId, resourceId } = row.original;
          const resourceInfo = resourceMap[resourceId];

          if (!resourceInfo) return null;

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-haspopup="true" size="icon" variant="ghost" className="size-8">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem className="gap-x-2" onClick={() => mutateRestore({ trashId })}>
                  <RefreshCcw className="size-4" />
                  {t('actions.restore')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-x-2 text-destructive focus:text-destructive"
                  onClick={() => {
                    setConfirmVisible(true);
                    setDeletingResource({
                      resourceId,
                      resourceType,
                      name: resourceInfo.name,
                    });
                  }}
                >
                  <Trash2 className="size-4" />
                  {t('actions.permanentDelete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];

    return tableColumns;
  }, [t, router, resourceMap, userMap, resourceType, mutateRestore]);

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && nextCursor) {
      fetchNextPage();
    }
  }, [fetchNextPage, isFetching, nextCursor]);

  const handleResourceTypeChange = (value: ResourceType.Space | ResourceType.Base) => {
    queryClient.invalidateQueries(ReactQueryKeys.getSpaceTrash(value));
    setResourceType(value);
  };

  const buttons = useMemo(() => {
    return [
      {
        value: ResourceType.Space,
        label: t('noun.space'),
      },
      {
        value: ResourceType.Base,
        label: t('noun.base'),
      },
    ];
  }, [t]);

  if (!isHydrated || isLoading) return null;

  return (
    <div className="flex h-screen flex-1 flex-col space-y-4 overflow-hidden py-8">
      <div className="flex items-center justify-between px-8">
        <h1 className="text-2xl font-semibold">{t('noun.trash')}</h1>
        <div className="flex items-center rounded-md border">
          {buttons.map(({ value, label }) => (
            <Button
              key={value}
              variant={resourceType === value ? 'default' : 'ghost'}
              size="sm"
              className="w-16"
              onClick={() =>
                handleResourceTypeChange(value as ResourceType.Space | ResourceType.Base)
              }
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <InfiniteTable
        rows={allRows}
        columns={columns}
        className="px-8"
        fetchNextPage={fetchNextPageInner}
      />
      <ConfirmDialog
        open={isConfirmVisible}
        onOpenChange={setConfirmVisible}
        title={t('trash.permanentDeleteTips', {
          name: deletingResource?.name,
          resource:
            deletingResource?.resourceType === ResourceType.Base ? t('noun.base') : t('noun.space'),
        })}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={() => {
          if (deletingResource == null) return;
          const { resourceId, resourceType } = deletingResource;
          setConfirmVisible(false);
          if (resourceType === ResourceType.Space) {
            return mutatePermanentDeleteSpace({
              spaceId: resourceId,
            });
          }
          mutatePermanentDeleteBase({
            baseId: resourceId,
          });
        }}
      />
    </div>
  );
};
