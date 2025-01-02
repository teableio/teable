import type { QueryFunctionContext } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { ITrashItemVo, ITrashVo } from '@teable/openapi';
import {
  getTrashItems,
  PrincipalType,
  resetTrashItems,
  ResourceType,
  restoreTrash,
} from '@teable/openapi';
import { InfiniteTable } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission, useIsHydrated } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { Collaborator } from '../../components/collaborator-manage/components/Collaborator';

export const BaseTrashPage = () => {
  const baseId = useBaseId() as string;
  const isHydrated = useIsHydrated();
  const queryClient = useQueryClient();
  const permission = useBasePermission();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const [userMap, setUserMap] = useState<ITrashVo['userMap']>({});
  const [resourceMap, setResourceMap] = useState<ITrashVo['resourceMap']>({});
  const [nextCursor, setNextCursor] = useState<string | null | undefined>();
  const [isConfirmVisible, setConfirmVisible] = useState(false);

  const queryFn = async ({ queryKey }: QueryFunctionContext) => {
    const res = await getTrashItems({
      resourceType: ResourceType.Base,
      resourceId: queryKey[1] as string,
    });
    const { trashItems, nextCursor } = res.data;

    setNextCursor(() => nextCursor);
    setUserMap({ ...userMap, ...res.data.userMap });
    setResourceMap({ ...resourceMap, ...res.data.resourceMap });

    return trashItems;
  };

  const { data, isFetching, isLoading, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getTrashItems(baseId),
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    getNextPageParam: () => nextCursor,
  });

  const { mutateAsync: mutateRestore } = useMutation({
    mutationFn: (props: { trashId: string }) => restoreTrash(props.trashId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getTrashItems(baseId));
      toast.success(t('actions.restoreSucceed'));
    },
  });

  const { mutateAsync: mutateResetTrash } = useMutation({
    mutationFn: () => resetTrashItems({ resourceType: ResourceType.Base, resourceId: baseId }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getTrashItems(baseId));
      toast.success(t('actions.resetSucceed'));
    },
  });

  const allRows = useMemo(
    () => (data ? data.pages.flatMap((d) => d) : []) as ITrashItemVo[],
    [data]
  );

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

          return (
            <Collaborator
              item={{ name, email, avatar, type: PrincipalType.User }}
              className="flex-1"
            />
          );
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
    ];

    if (permission?.['table|create']) {
      tableColumns.push({
        accessorKey: 'id',
        header: t('actions.title'),
        size: 80,
        cell: ({ row }) => {
          const trashId = row.getValue<string>('id');
          return (
            <Button size="xs" className="text-[13px]" onClick={() => mutateRestore({ trashId })}>
              {t('actions.restore')}
            </Button>
          );
        },
      });
    }

    return tableColumns;
  }, [t, resourceMap, userMap, mutateRestore, permission]);

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && nextCursor) {
      fetchNextPage();
    }
  }, [fetchNextPage, isFetching, nextCursor]);

  if (!isHydrated || isLoading) return null;

  return (
    <>
      <div className="flex h-screen w-full flex-1 flex-col space-y-4 overflow-hidden pt-8">
        <div className="flex w-full items-center justify-between px-8 pb-2">
          <h1 className="text-2xl font-semibold">{t('noun.trash')}</h1>
          {permission?.['table|delete'] && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmVisible(true)}
              disabled={!allRows.length}
            >
              {t('trash.resetTrash')}
            </Button>
          )}
        </div>
        <InfiniteTable
          rows={allRows}
          columns={columns}
          className="px-8"
          fetchNextPage={fetchNextPageInner}
        />
      </div>
      <ConfirmDialog
        open={isConfirmVisible}
        onOpenChange={setConfirmVisible}
        title={t('trash.resetTrashConfirm')}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={() => {
          setConfirmVisible(false);
          mutateResetTrash();
        }}
      />
    </>
  );
};
