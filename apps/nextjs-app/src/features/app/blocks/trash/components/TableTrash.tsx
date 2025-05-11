import type { QueryFunctionContext } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type {
  ITrashVo,
  ITableTrashItemVo,
  IViewSnapshotItemVo,
  IFieldSnapshotItemVo,
} from '@teable/openapi';
import { getTrashItems, ResourceType, restoreTrash } from '@teable/openapi';
import { CollaboratorWithHoverCard, InfiniteTable } from '@teable/sdk/components';
import { VIEW_ICON_MAP } from '@teable/sdk/components/view/constant';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  useBasePermission,
  useFieldStaticGetter,
  useIsHydrated,
  useTableId,
} from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export const TableTrash = () => {
  const tableId = useTableId() as string;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const isHydrated = useIsHydrated();
  const queryClient = useQueryClient();
  const getFieldStatic = useFieldStaticGetter();
  const permission = useBasePermission();

  const hasRestorePermission = permission?.['table|trash_update'];

  const [nextCursor, setNextCursor] = useState<string | null | undefined>();
  const [userMap, setUserMap] = useState<ITrashVo['userMap']>({});
  const [resourceMap, setResourceMap] = useState<ITrashVo['resourceMap']>({});

  const queryFn = async ({ queryKey, pageParam }: QueryFunctionContext) => {
    const res = await getTrashItems({
      resourceType: ResourceType.Table,
      resourceId: queryKey[1] as string,
      cursor: pageParam,
    });
    const { trashItems, nextCursor } = res.data;
    setNextCursor(() => nextCursor);
    setUserMap({ ...userMap, ...res.data.userMap });
    setResourceMap({ ...resourceMap, ...res.data.resourceMap });
    return trashItems;
  };

  const { data, isFetching, isLoading, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getTrashItems(tableId),
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    getNextPageParam: () => nextCursor,
  });

  const { mutateAsync: mutateRestore } = useMutation({
    mutationFn: (props: { trashId: string }) => restoreTrash(props.trashId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getTrashItems(tableId));
      toast.success(t('actions.restoreSucceed'));
    },
  });

  const allRows = useMemo(
    () => (data ? data.pages.flatMap((d) => d) : []) as ITableTrashItemVo[],
    [data]
  );

  const columns: ColumnDef<ITableTrashItemVo>[] = useMemo(() => {
    const result: ColumnDef<ITableTrashItemVo>[] = [
      {
        accessorKey: 'deletedTime',
        header: t('trash.deletedTime'),
        size: 90,
        cell: ({ row }) => {
          const deletedTime = row.getValue<string>('deletedTime');
          const deletedDate = dayjs(deletedTime);
          const isToday = deletedDate.isSame(dayjs(), 'day');
          return (
            <div className="text-xs" title={deletedDate.format('YYYY/MM/DD HH:mm')}>
              {deletedDate.format(isToday ? 'HH:mm' : 'YYYY/MM/DD')}
            </div>
          );
        },
      },
      {
        accessorKey: 'deletedBy',
        header: t('trash.deletedBy'),
        size: 80,
        cell: ({ row }) => {
          const deletedBy = row.getValue<string>('deletedBy');
          const user = userMap[deletedBy];

          if (!user) return null;

          const { id, name, avatar, email } = user;

          return (
            <div className="flex justify-center">
              <CollaboratorWithHoverCard id={id} name={name} avatar={avatar} email={email} />
            </div>
          );
        },
      },
      {
        accessorKey: 'resourceType',
        header: t('table:tableTrash.resourceType'),
        size: 100,
        cell: ({ row }) => {
          const resourceType = row.getValue<string>('resourceType');
          const resourceStringMap: Record<string, string> = {
            [ResourceType.View]: t('noun.view'),
            [ResourceType.Field]: t('noun.field'),
            [ResourceType.Record]: t('noun.record'),
          };

          return <div className="flex items-center gap-x-1">{resourceStringMap[resourceType]}</div>;
        },
      },
      {
        accessorKey: 'resourceIds',
        header: t('table:tableTrash.deletedResource'),
        size: Number.MAX_SAFE_INTEGER,
        minSize: 200,
        cell: ({ row }) => {
          const resourceType = row.getValue<ResourceType>('resourceType');
          const resourceIds = row.getValue<ITableTrashItemVo['resourceIds']>('resourceIds');
          const resourceList = resourceIds
            .map((resourceId) => {
              return resourceMap[resourceId];
            })
            .filter(Boolean);
          return (
            <Fragment>
              {resourceList.length ? (
                <div className="flex w-full flex-wrap gap-1">
                  {resourceList.map((resource) => {
                    const { id, name } = resource;
                    const Icon =
                      resourceType === ResourceType.Field
                        ? getFieldStatic((resource as IFieldSnapshotItemVo).type, {
                            isLookup: Boolean((resource as IFieldSnapshotItemVo).isLookup),
                            hasAiConfig: false,
                          }).Icon
                        : resourceType === ResourceType.View
                          ? VIEW_ICON_MAP[(resource as IViewSnapshotItemVo).type]
                          : null;
                    return (
                      <div
                        key={id}
                        className="flex items-center rounded-sm bg-muted px-2 py-[2px] text-xs"
                      >
                        {Icon && <Icon className="mr-1 size-3" />}
                        {name || t('sdk:common.unnamedRecord')}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className="text-gray-500">{t('common.empty')}</span>
              )}
            </Fragment>
          );
        },
      },
    ];

    if (hasRestorePermission) {
      result.push({
        accessorKey: 'id',
        header: t('actions.title'),
        size: 80,
        cell: ({ row }) => {
          const trashId = row.getValue<string>('id');
          return (
            <Button size="sm" onClick={() => mutateRestore({ trashId })}>
              {t('actions.restore')}
            </Button>
          );
        },
      });
    }
    return result;
  }, [t, userMap, resourceMap, hasRestorePermission, getFieldStatic, mutateRestore]);

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && nextCursor) {
      fetchNextPage();
    }
  }, [fetchNextPage, isFetching, nextCursor]);

  if (!isHydrated || isLoading) return null;

  return (
    <InfiniteTable
      rows={allRows}
      columns={columns}
      className="sm:overflow-x-hidden"
      fetchNextPage={fetchNextPageInner}
    />
  );
};
