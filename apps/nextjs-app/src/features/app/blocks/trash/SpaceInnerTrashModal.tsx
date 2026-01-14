import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Database, Trash2 } from '@teable/icons';
import type { ITrashItemVo, ITrashVo } from '@teable/openapi';
import {
  getTrash,
  ResourceType,
  restoreTrash,
  permanentDeleteBase,
  PrincipalType,
} from '@teable/openapi';
import { InfiniteTable } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsHydrated } from '@teable/sdk/hooks';
import { ConfirmDialog, Spin } from '@teable/ui-lib/base';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import { IterationCcwIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { Collaborator } from '../../components/collaborator-manage/components/Collaborator';

interface ISpaceInnerTrashModalProps {
  children: React.ReactNode;
  spaceId: string;
}

export const SpaceInnerTrashModal = (props: ISpaceInnerTrashModalProps) => {
  const { children, spaceId } = props;
  const isHydrated = useIsHydrated();
  const queryClient = useQueryClient();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const resourceType = ResourceType.Base;

  const [open, setOpen] = useState(false);
  const [userMap, setUserMap] = useState<ITrashVo['userMap']>({});
  const [resourceMap, setResourceMap] = useState<ITrashVo['resourceMap']>({});
  const [nextCursor, setNextCursor] = useState<string | null | undefined>();
  const [isConfirmVisible, setConfirmVisible] = useState(false);
  const [deletingResource, setDeletingResource] = useState<
    { resourceId: string; name: string } | undefined
  >();

  const queryFn = async () => {
    const res = await getTrash({ spaceId, resourceType });
    const { trashItems, nextCursor } = res.data;

    setNextCursor(() => nextCursor);
    setUserMap((prev) => ({ ...prev, ...res.data.userMap }));
    setResourceMap((prev) => ({ ...prev, ...res.data.resourceMap }));

    return trashItems;
  };

  const { data, isFetching, isLoading, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getSpaceTrash(resourceType, spaceId),
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: () => nextCursor,
    enabled: open,
  });

  const { mutateAsync: mutateRestore } = useMutation({
    mutationFn: (props: { trashId: string }) => restoreTrash(props.trashId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.getSpaceTrash(resourceType, spaceId),
      });
      toast.success(t('actions.restoreSucceed'));
    },
  });

  const { mutateAsync: mutatePermanentDeleteBase } = useMutation({
    mutationFn: (props: { baseId: string }) => permanentDeleteBase(props.baseId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.getSpaceTrash(resourceType, spaceId),
      });
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
            <div className="flex min-w-0 items-center gap-2 pl-2">
              <Database className="size-6 rounded-md border p-1" />
              <span className="truncate text-sm ">{name}</span>
            </div>
          );
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
      {
        id: 'actions',
        header: t('actions.title'),
        size: 80,
        cell: ({ row }) => {
          const { id: trashId, resourceId } = row.original;
          const resourceInfo = resourceMap[resourceId];

          if (!resourceInfo) return null;

          return (
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                className="p-1"
                title={t('actions.restore')}
                onClick={() => mutateRestore({ trashId })}
              >
                <IterationCcwIcon className="size-4" />
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="p-1"
                title={t('actions.permanentDelete')}
                onClick={() => {
                  setConfirmVisible(true);
                  setDeletingResource({
                    resourceId,
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

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="flex h-[85%] max-h-[85%] max-w-[80%] flex-col gap-0 p-0 transition-[max-width] duration-300">
          <DialogHeader className="flex w-full border-b p-4">
            <DialogTitle>{t('noun.trash')}</DialogTitle>
            <DialogDescription>{t('space:trash.baseDescription')}</DialogDescription>
          </DialogHeader>
          <div className="h-full flex-col overflow-hidden p-4">
            {isHydrated && !isLoading ? (
              <InfiniteTable rows={allRows} columns={columns} fetchNextPage={fetchNextPageInner} />
            ) : (
              <Spin className="size-4" />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={isConfirmVisible}
        onOpenChange={setConfirmVisible}
        title={t('trash.permanentDeleteTips', {
          name: deletingResource?.name,
          resource: t('noun.base'),
        })}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={() => {
          if (deletingResource == null) return;
          const { resourceId } = deletingResource;
          setConfirmVisible(false);
          mutatePermanentDeleteBase({
            baseId: resourceId,
          });
        }}
      />
    </>
  );
};
