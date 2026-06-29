import type { QueryFunctionContext } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type {
  IRestoreFieldTrashStreamDoneEvent,
  IRestoreFieldTrashStreamErrorEvent,
  IRestoreFieldTrashStreamProgressEvent,
  ITrashVo,
  ITableTrashItemVo,
  IViewSnapshotItemVo,
  IFieldSnapshotItemVo,
} from '@teable/openapi';
import {
  getTrashItems,
  TrashType,
  restoreTrash,
  restoreFieldTrashStream,
  TableTrashType,
} from '@teable/openapi';
import { CollaboratorWithHoverCard, InfiniteTable } from '@teable/sdk/components';
import { VIEW_ICON_MAP } from '@teable/sdk/components/view/constant';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase, useBasePermission, useFieldStaticGetter, useIsHydrated } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { RestoreFieldTrashProgressDialog } from './RestoreFieldTrashProgressDialog';
import type { SelectionActionDialogStatus } from '../../view/grid/components/SelectionActionProgressDialog';

interface ITableTrashProps {
  tableId: string;
}

export const TableTrash = (props: ITableTrashProps) => {
  const { tableId } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const isHydrated = useIsHydrated();
  const queryClient = useQueryClient();
  const getFieldStatic = useFieldStaticGetter();
  const permission = useBasePermission();
  const base = useBase();

  const hasRestorePermission = permission?.['table|trash_update'];
  const useV2RestoreField = base?.v2Status?.useV2 ?? Boolean(base?.isCanary);

  const [nextCursor, setNextCursor] = useState<string | null | undefined>();
  const [userMap, setUserMap] = useState<ITrashVo['userMap']>({});
  const [resourceMap, setResourceMap] = useState<ITrashVo['resourceMap']>({});
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreProgress, setRestoreProgress] =
    useState<IRestoreFieldTrashStreamProgressEvent | null>(null);
  const [restoreSummary, setRestoreSummary] =
    useState<IRestoreFieldTrashStreamDoneEvent | null>(null);
  const [restoreErrors, setRestoreErrors] = useState<IRestoreFieldTrashStreamErrorEvent[]>([]);
  const [restoreStatus, setRestoreStatus] = useState<SelectionActionDialogStatus | null>(null);
  const [restoringTrashId, setRestoringTrashId] = useState<string | null>(null);
  const restoreErrorsRef = useRef<IRestoreFieldTrashStreamErrorEvent[]>([]);
  const restoreProgressRef = useRef<IRestoreFieldTrashStreamProgressEvent | null>(null);

  const queryFn = async ({
    queryKey,
    pageParam,
  }: QueryFunctionContext<readonly ['trash-items', string], string | undefined>) => {
    const res = await getTrashItems({
      resourceType: TrashType.Table,
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
    initialPageParam: undefined as string | undefined,
    getNextPageParam: () => nextCursor,
  });

  const { mutateAsync: mutateRestore } = useMutation({
    mutationFn: (props: { trashId: string }) => restoreTrash(props.trashId, tableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(tableId) });
      toast.success(t('actions.restoreSucceed'));
    },
  });

  const restoreFieldTrash = useCallback(
    async (trashId: string) => {
      setRestoringTrashId(trashId);
      setRestoreProgress(null);
      setRestoreSummary(null);
      setRestoreErrors([]);
      restoreErrorsRef.current = [];
      restoreProgressRef.current = null;
      setRestoreStatus('running');
      setRestoreDialogOpen(true);

      try {
        const { done, errors } = await restoreFieldTrashStream(trashId, tableId, {
          onProgress: (progress) => {
            restoreProgressRef.current = progress;
            setRestoreProgress(progress);
          },
          onError: (error) => {
            restoreErrorsRef.current = [...restoreErrorsRef.current, error];
            setRestoreErrors(restoreErrorsRef.current);
          },
        });

        setRestoreSummary(done);
        setRestoreErrors(errors);
        restoreErrorsRef.current = errors;
        setRestoreStatus(errors.length ? 'partial' : 'success');
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(tableId) });
        toast.success(t('actions.restoreSucceed'));
      } catch (error) {
        if (!restoreErrorsRef.current.length) {
          const message = error instanceof Error ? error.message : String(error);
          const latestProgress = restoreProgressRef.current as
            | IRestoreFieldTrashStreamProgressEvent
            | null;
          const streamError: IRestoreFieldTrashStreamErrorEvent = {
            id: 'error',
            phase: 'restoring',
            batchIndex: -1,
            totalCount: latestProgress?.totalCount ?? 0,
            processedCount: latestProgress?.processedCount ?? 0,
            updatedCount: latestProgress?.updatedCount ?? 0,
            message,
          };
          restoreErrorsRef.current = [streamError];
          setRestoreErrors(restoreErrorsRef.current);
        }
        setRestoreStatus('error');
      } finally {
        setRestoringTrashId(null);
      }
    },
    [queryClient, t, tableId]
  );

  const handleRestore = useCallback(
    async (item: ITableTrashItemVo) => {
      if (item.resourceType === TableTrashType.Field && useV2RestoreField) {
        await restoreFieldTrash(item.id);
        return;
      }
      await mutateRestore({ trashId: item.id });
    },
    [mutateRestore, restoreFieldTrash, useV2RestoreField]
  );

  const allRows = useMemo(
    () => (data ? data.pages.flatMap((d) => d) : []) as ITableTrashItemVo[],
    [data]
  );

  const columns: ColumnDef<ITableTrashItemVo>[] = useMemo(() => {
    const result: ColumnDef<ITableTrashItemVo>[] = [
      {
        accessorKey: 'resourceIds',
        header: t('table:tableTrash.deletedResource'),
        size: Number.MAX_SAFE_INTEGER,
        minSize: 200,
        cell: ({ row }) => {
          const resourceType = row.getValue<TableTrashType>('resourceType');
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
                      resourceType === TableTrashType.Field
                        ? getFieldStatic((resource as IFieldSnapshotItemVo).type, {
                            isLookup: Boolean((resource as IFieldSnapshotItemVo).isLookup),
                            isConditionalLookup: Boolean(
                              (resource as IFieldSnapshotItemVo).isConditionalLookup
                            ),
                            hasAiConfig: false,
                          }).Icon
                        : resourceType === TableTrashType.View
                          ? VIEW_ICON_MAP[(resource as IViewSnapshotItemVo).type]
                          : null;
                    return (
                      <div
                        key={id}
                        className="flex items-center rounded-sm border bg-muted px-2 py-[2px] text-xs"
                      >
                        {Icon && <Icon className="mr-1 size-3" />}
                        {name || t('sdk:common.unnamedRecord')}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className="text-muted-foreground">{t('common.empty')}</span>
              )}
            </Fragment>
          );
        },
      },
      {
        accessorKey: 'resourceType',
        header: t('table:tableTrash.resourceType'),
        size: 96,
        cell: ({ row }) => {
          const resourceType = row.getValue<string>('resourceType');
          const resourceStringMap: Record<string, string> = {
            [TableTrashType.View]: t('noun.view'),
            [TableTrashType.Field]: t('noun.field'),
            [TableTrashType.Record]: t('noun.record'),
          };

          return <div className="flex items-center gap-x-1">{resourceStringMap[resourceType]}</div>;
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
        accessorKey: 'deletedTime',
        header: t('trash.deletedTime'),
        size: 80,
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
    ];

    if (hasRestorePermission) {
      result.push({
        accessorKey: 'id',
        header: t('actions.title'),
        size: 104,
        minSize: 104,
        cell: ({ row }) => {
          const trashId = row.getValue<string>('id');
          const isRestoring = restoringTrashId === trashId;
          return (
            <Button
              size="sm"
              variant={'outline'}
              disabled={isRestoring}
              onClick={() => handleRestore(row.original)}
            >
              {t('actions.restore')}
            </Button>
          );
        },
      });
    }
    return result;
  }, [
    t,
    userMap,
    resourceMap,
    hasRestorePermission,
    getFieldStatic,
    restoringTrashId,
    handleRestore,
  ]);

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && nextCursor) {
      fetchNextPage();
    }
  }, [fetchNextPage, isFetching, nextCursor]);

  if (!isHydrated || isLoading) return null;

  return (
    <>
      <InfiniteTable
        rows={allRows}
        columns={columns}
        className="sm:overflow-x-hidden"
        fetchNextPage={fetchNextPageInner}
      />
      <RestoreFieldTrashProgressDialog
        open={restoreDialogOpen}
        progress={restoreProgress}
        summary={restoreSummary}
        errors={restoreErrors}
        status={restoreStatus}
        onOpenChange={setRestoreDialogOpen}
      />
    </>
  );
};
