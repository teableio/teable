import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, Trash2 } from '@teable/icons';
import type { ITrashItemVo, ITrashVo } from '@teable/openapi';
import { getTrash, restoreTrash, deleteTrash, PrincipalType, TrashType } from '@teable/openapi';
import { InfiniteTable } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsHydrated } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import { IterationCcwIcon } from 'lucide-react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { useBrand } from '@/features/app/hooks/useBrand';
import { spaceConfig } from '@/features/i18n/space.config';
import { Collaborator } from '../../components/collaborator-manage/components/Collaborator';
import { SpaceAvatar } from '../../components/space/SpaceAvatar';
import { useEnv } from '../../hooks/useEnv';
import { useIsCommunity } from '../../hooks/useIsCommunity';

export const SpaceTrashPage = () => {
  const isHydrated = useIsHydrated();
  const queryClient = useQueryClient();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { brandName } = useBrand();
  const router = useRouter();
  const resourceType = TrashType.Space;

  const onBack = () => {
    router.push({ pathname: '/space' });
  };
  const { trash } = useEnv();
  const retentionDays = trash?.retentionDays ?? 0;
  const isCommunity = useIsCommunity();
  const [userMap, setUserMap] = useState<ITrashVo['userMap']>({});
  const [resourceMap, setResourceMap] = useState<ITrashVo['resourceMap']>({});
  const [nextCursor, setNextCursor] = useState<string | null | undefined>();
  const [isConfirmVisible, setConfirmVisible] = useState(false);
  const [deletingResource, setDeletingResource] = useState<
    { trashId: string; name: string } | undefined
  >();

  const queryFn = async () => {
    const res = await getTrash({ resourceType });
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
    initialPageParam: undefined as string | undefined,
    getNextPageParam: () => nextCursor,
  });

  const { mutateAsync: mutateRestore } = useMutation({
    mutationFn: (props: { trashId: string }) => restoreTrash(props.trashId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getSpaceTrash(resourceType) });
      toast.success(t('actions.restoreSucceed'));
    },
  });

  const { mutateAsync: mutatePermanentDelete } = useMutation({
    mutationFn: (props: { trashId: string }) => deleteTrash(props.trashId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getSpaceTrash(resourceType) });
      toast.success(t('actions.deleteSucceed'));
    },
  });

  const allRows = useMemo(
    () => (data ? (data.pages.flatMap((d) => d) as ITrashItemVo[]) : []),
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

          return (
            <div className="flex min-w-0 items-center gap-2">
              <SpaceAvatar name={name} className="size-6" />
              <span className="truncate text-sm ">{name}</span>
            </div>
          );
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
          const { id: trashId, resourceId } = row.original;
          const resourceInfo = resourceMap[resourceId];

          if (!resourceInfo) return null;

          return (
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                className="size-8 p-0"
                title={t('actions.restore')}
                onClick={() => mutateRestore({ trashId })}
              >
                <IterationCcwIcon className="size-4" />
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="size-8 p-0"
                title={t('actions.permanentDelete')}
                onClick={() => {
                  setConfirmVisible(true);
                  setDeletingResource({
                    trashId,
                    name: resourceInfo.name,
                  });
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          );
        },
      },
    ];

    return tableColumns;
  }, [t, resourceMap, userMap, mutateRestore]);

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && nextCursor) {
      fetchNextPage();
    }
  }, [fetchNextPage, isFetching, nextCursor]);

  if (!isHydrated || isLoading) return null;

  return (
    <div className="flex h-screen flex-1 flex-col space-y-4 overflow-hidden p-8">
      <Head>
        <title>{`${t('common:trash.spaceTrash')} - ${brandName}`}</title>
      </Head>
      <div className="flex flex-col items-start justify-between gap-2 ">
        <Button
          className="h-6 p-0 text-sm text-muted-foreground hover:no-underline hover:opacity-75"
          variant="link"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
          <span>{t('common:settings.back')}</span>
        </Button>
        <h1 className="text-2xl font-semibold">{t('noun.trash')}</h1>
        {!isCommunity && retentionDays > 0 && (
          <p className="shrink-0 grow-0 text-left text-sm text-zinc-500">
            {t('common:trash.spaceDescription', { retentionDays })}
          </p>
        )}
      </div>
      <InfiniteTable rows={allRows} columns={columns} fetchNextPage={fetchNextPageInner} />
      <ConfirmDialog
        open={isConfirmVisible}
        onOpenChange={setConfirmVisible}
        title={t('trash.permanentDeleteTips', {
          name: deletingResource?.name,
          resource: t('noun.space'),
        })}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={() => {
          if (deletingResource == null) return;
          const { trashId } = deletingResource;
          setConfirmVisible(false);
          mutatePermanentDelete({
            trashId,
          });
        }}
      />
    </div>
  );
};
