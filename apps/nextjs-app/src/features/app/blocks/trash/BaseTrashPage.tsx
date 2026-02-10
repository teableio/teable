import type { QueryFunctionContext } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { ITrashItemVo, ITrashVo } from '@teable/openapi';
import {
  getTrashItems,
  PrincipalType,
  resetTrashItems,
  restoreTrash,
  TrashType,
} from '@teable/openapi';
import { InfiniteTable } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission, useIsHydrated } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { useBrand } from '@/features/app/hooks/useBrand';
import { useEnv } from '@/features/app/hooks/useEnv';
import { spaceConfig } from '@/features/i18n/space.config';
import { Collaborator } from '../../components/collaborator-manage/components/Collaborator';
import { useIsCommunity } from '../../hooks/useIsCommunity';

export const BaseTrashPage = () => {
  const baseId = useBaseId() as string;
  const isHydrated = useIsHydrated();
  const queryClient = useQueryClient();
  const permission = useBasePermission();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { brandName } = useBrand();
  const isCommunity = useIsCommunity();
  const { trash } = useEnv();
  const retentionDays = trash?.retentionDays ?? 0;
  const [userMap, setUserMap] = useState<ITrashVo['userMap']>({});
  const [resourceMap, setResourceMap] = useState<ITrashVo['resourceMap']>({});
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [isConfirmVisible, setConfirmVisible] = useState(false);

  const queryFn = async ({ queryKey, pageParam }: QueryFunctionContext) => {
    const res = await getTrashItems({
      resourceType: TrashType.Base,
      resourceId: queryKey[1] as string,
      cursor: pageParam as string | undefined,
      pageSize: 20,
    });
    const {
      trashItems,
      nextCursor: newNextCursor,
      userMap: newUserMap,
      resourceMap: newResourceMap,
    } = res.data;

    setNextCursor(newNextCursor);
    setUserMap((prev) => ({ ...prev, ...newUserMap }));
    setResourceMap((prev) => ({ ...prev, ...newResourceMap }));

    return trashItems;
  };

  const { data, isFetching, isLoading, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getTrashItems(baseId),
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: () => nextCursor ?? undefined,
  });

  const { mutateAsync: mutateRestore } = useMutation({
    mutationFn: (props: { trashId: string }) => restoreTrash(props.trashId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(baseId) });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseNodeTree(baseId) });
      toast.success(t('actions.restoreSucceed'));
    },
  });

  const { mutateAsync: mutateResetTrash, isPending: isResetting } = useMutation({
    mutationFn: () => resetTrashItems({ resourceType: TrashType.Base, resourceId: baseId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(baseId) });
      toast.success(t('actions.resetSucceed'));
    },
  });

  const allRows = useMemo(
    () => (data ? data.pages.flatMap((d) => d) : []) as ITrashItemVo[],
    [data]
  );

  const canReset =
    permission?.['table|delete'] && permission?.['app|delete'] && permission?.['automation|delete'];

  const canRestore = useCallback(
    (resourceType: string) => {
      switch (resourceType) {
        case TrashType.Table:
          return permission?.['table|create'];
        case TrashType.App:
          return permission?.['app|create'];
        case TrashType.Workflow:
          return permission?.['automation|create'];
        default:
          return false;
      }
    },
    [permission]
  );

  const columns: ColumnDef<ITrashItemVo>[] = useMemo(() => {
    const tableColumns: ColumnDef<ITrashItemVo>[] = [
      {
        accessorKey: 'resourceId',
        header: t('name'),
        size: Number.MAX_SAFE_INTEGER,
        minSize: 156,
        cell: ({ row }) => {
          const resourceId = row.getValue<string>('resourceId');
          const resourceInfo = resourceMap[resourceId];

          if (!resourceInfo) return null;

          const { name } = resourceInfo;

          return (
            <div className="truncate text-wrap text-sm" title={name}>
              {name}
            </div>
          );
        },
      },
      {
        accessorKey: 'resourceType',
        header: t('trash.type'),
        size: 96,
        cell: ({ row }) => {
          const resourceType = row.getValue<string>('resourceType');
          const resourceName = () => {
            switch (resourceType) {
              case TrashType.Table:
                return t('common:noun.table');
              case TrashType.App:
                return t('common:noun.app');
              case TrashType.Workflow:
                return t('common:noun.automation');
              default:
                return '';
            }
          };

          return <div className="text-wrap pr-2 text-sm">{resourceName()}</div>;
        },
      },
      {
        accessorKey: 'deletedBy',
        header: t('trash.deletedBy'),
        size: 196,
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
        size: 156,
        cell: ({ row }) => {
          const deletedTime = row.getValue<string>('deletedTime');
          const deletedDateStr = dayjs(deletedTime).format('YYYY/MM/DD HH:mm');
          return <div title={deletedDateStr}>{deletedDateStr}</div>;
        },
      },
      {
        id: 'actions',
        header: t('actions.title'),
        size: 108,
        cell: ({ row }) => {
          const { id: trashId, resourceId, resourceType } = row.original;
          const resourceInfo = resourceMap[resourceId];

          if (!resourceInfo) return null;

          const showRestore = canRestore(resourceType);

          if (!showRestore) return null;

          return (
            <Button
              size="xs"
              variant="outline"
              title={t('actions.restore')}
              onClick={() => mutateRestore({ trashId })}
            >
              {t('actions.restore')}
            </Button>
          );
        },
      },
    ];

    return tableColumns;
  }, [t, resourceMap, userMap, mutateRestore, canRestore]);

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && nextCursor) {
      fetchNextPage();
    }
  }, [fetchNextPage, isFetching, nextCursor]);

  const handleResetTrash = useCallback(() => {
    setConfirmVisible(true);
  }, []);

  const handleConfirmReset = useCallback(() => {
    setConfirmVisible(false);
    mutateResetTrash();
  }, [mutateResetTrash]);

  if (!isHydrated || isLoading) return null;

  return (
    <>
      <div className="flex h-screen w-full flex-1 flex-col space-y-4 overflow-hidden pt-8">
        <Head>
          <title>{`${t('noun.trash')} - ${brandName}`}</title>
        </Head>
        <div className="flex w-full items-center justify-between px-8 pb-2">
          <div className="flex flex-col items-start gap-2">
            <h1 className="text-2xl font-semibold">{t('noun.trash')}</h1>
            {!isCommunity && retentionDays > 0 && (
              <p className="shrink-0 grow-0 text-left text-sm text-zinc-500">
                {t('common:trash.baseDescription', { retentionDays })}
              </p>
            )}
          </div>
          {canReset && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleResetTrash}
              disabled={allRows.length === 0 || isResetting}
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
        onConfirm={handleConfirmReset}
      />
    </>
  );
};
