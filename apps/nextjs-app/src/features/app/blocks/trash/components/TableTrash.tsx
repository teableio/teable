import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type {
  IRestoreFieldTrashStreamDoneEvent,
  IRestoreFieldTrashStreamErrorEvent,
  IRestoreFieldTrashStreamProgressEvent,
  ITableTrashItemsFilter,
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
import type { IDateRangeValue } from '@teable/sdk/components/filter/view-filter/component/filterDatePicker/DateRangePicker';
import { VIEW_ICON_MAP } from '@teable/sdk/components/view/constant';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  useBase,
  useBasePermission,
  useCollaboratorFilterUsers,
  useFieldStaticGetter,
  useIsHydrated,
} from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import type { SelectionActionDialogStatus } from '../../view/grid/components/SelectionActionProgressDialog';
import { RestoreFieldTrashProgressDialog } from './RestoreFieldTrashProgressDialog';
import { TableTrashFilterBar } from './TableTrashFilterBar';
import { TrashRecordsDialog } from './TrashRecordsDialog';

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

  const [resourceTypes, setResourceTypes] = useState<TableTrashType[]>([]);
  const [deletedByIds, setDeletedByIds] = useState<string[]>([]);
  const [deletedDateRange, setDeletedDateRange] = useState<IDateRangeValue | null>(null);
  // The item stays set while the close animation plays; only `recordsDialogOpen` drives
  // the dialog, otherwise the closing dialog flashes empty.
  const [viewingItem, setViewingItem] = useState<ITableTrashItemVo | null>(null);
  const [recordsDialogOpen, setRecordsDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreProgress, setRestoreProgress] =
    useState<IRestoreFieldTrashStreamProgressEvent | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<IRestoreFieldTrashStreamDoneEvent | null>(
    null
  );
  const [restoreErrors, setRestoreErrors] = useState<IRestoreFieldTrashStreamErrorEvent[]>([]);
  const [restoreStatus, setRestoreStatus] = useState<SelectionActionDialogStatus | null>(null);
  const [restoringTrashId, setRestoringTrashId] = useState<string | null>(null);
  const restoreErrorsRef = useRef<IRestoreFieldTrashStreamErrorEvent[]>([]);
  const restoreProgressRef = useRef<IRestoreFieldTrashStreamProgressEvent | null>(null);

  const trashQuery = useMemo<ITableTrashItemsFilter>(
    () => ({
      ...(resourceTypes.length ? { resourceTypes } : {}),
      ...(deletedByIds.length ? { deletedBy: deletedByIds } : {}),
      ...(deletedDateRange?.exactDate ? { deletedTimeStart: deletedDateRange.exactDate } : {}),
      ...(deletedDateRange?.exactDateEnd ? { deletedTimeEnd: deletedDateRange.exactDateEnd } : {}),
    }),
    [resourceTypes, deletedByIds, deletedDateRange]
  );

  const { data, isFetching, isLoading, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getTrashItems(tableId, trashQuery),
    queryFn: ({ pageParam }) =>
      getTrashItems({
        resourceType: TrashType.Table,
        resourceId: tableId,
        cursor: pageParam,
        ...trashQuery,
      }).then((res) => res.data),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ITrashVo) => lastPage.nextCursor ?? undefined,
  });

  const allRows = useMemo(
    () => (data ? data.pages.flatMap((page) => page.trashItems) : []) as ITableTrashItemVo[],
    [data]
  );

  const userMap = useMemo(() => {
    const map: ITrashVo['userMap'] = {};
    data?.pages.forEach((page) => Object.assign(map, page.userMap));
    return map;
  }, [data]);

  const resourceMap = useMemo(() => {
    const map: ITrashVo['resourceMap'] = {};
    data?.pages.forEach((page) => Object.assign(map, page.resourceMap));
    return map;
  }, [data]);

  const { users: filterUsers, setUserSearch } = useCollaboratorFilterUsers({
    selectedIds: deletedByIds,
    userMap,
  });

  const onFilterReset = useCallback(() => {
    setResourceTypes([]);
    setDeletedByIds([]);
    setDeletedDateRange(null);
    setUserSearch('');
  }, [setUserSearch]);

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
          const latestProgress =
            restoreProgressRef.current as IRestoreFieldTrashStreamProgressEvent | null;
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

  const handleViewRecords = useCallback((item: ITableTrashItemVo) => {
    setViewingItem(item);
    setRecordsDialogOpen(true);
  }, []);

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
          const isRecord = resourceType === TableTrashType.Record;
          // The server only returns a preview of each item's resources; the rest are
          // represented by the total count.
          const displayList = resourceIds
            .map((resourceId) => {
              return resourceMap[resourceId];
            })
            .filter(Boolean);
          const hiddenCount = row.original.totalResourceCount - displayList.length;
          const chips = (
            <Fragment>
              {displayList.map((resource) => {
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
                  <span
                    key={id}
                    className="flex items-center rounded-sm border bg-muted px-2 py-[2px] text-xs"
                  >
                    {Icon && <Icon className="me-1 size-3" />}
                    {name || t('sdk:common.unnamedRecord')}
                  </span>
                );
              })}
              {hiddenCount > 0 && (
                <span className="ms-1 flex items-center text-xs text-muted-foreground">
                  {t('table:tableTrash.moreResources', { count: hiddenCount })}
                </span>
              )}
            </Fragment>
          );
          if (!displayList.length && hiddenCount <= 0) {
            return <span className="text-muted-foreground">{t('sdk:common.empty')}</span>;
          }
          // Record rows: the whole chip block is one click target opening the records grid.
          return isRecord ? (
            <button
              type="button"
              className="-m-1 flex w-full cursor-pointer flex-wrap gap-1 rounded-md p-1 text-start hover:bg-primary/10"
              onClick={() => handleViewRecords(row.original)}
            >
              {chips}
            </button>
          ) : (
            <div className="flex w-full flex-wrap gap-1">{chips}</div>
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
    handleViewRecords,
  ]);

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && hasNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, isFetching, hasNextPage]);

  if (!isHydrated || isLoading) return null;

  return (
    <div className="flex size-full min-h-0 flex-col">
      <TableTrashFilterBar
        users={filterUsers}
        resourceTypes={resourceTypes}
        deletedByIds={deletedByIds}
        dateRange={deletedDateRange}
        onResourceTypesChange={setResourceTypes}
        onDeletedByIdsChange={setDeletedByIds}
        onDateRangeChange={setDeletedDateRange}
        onUserSearch={setUserSearch}
        onReset={onFilterReset}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <InfiniteTable
          rows={allRows}
          columns={columns}
          className="sm:overflow-x-hidden"
          fetchNextPage={fetchNextPageInner}
        />
      </div>
      <TrashRecordsDialog
        tableId={tableId}
        trashItem={viewingItem}
        open={recordsDialogOpen}
        onOpenChange={setRecordsDialogOpen}
      />
      <RestoreFieldTrashProgressDialog
        open={restoreDialogOpen}
        progress={restoreProgress}
        summary={restoreSummary}
        errors={restoreErrors}
        status={restoreStatus}
        onOpenChange={setRestoreDialogOpen}
      />
    </div>
  );
};
