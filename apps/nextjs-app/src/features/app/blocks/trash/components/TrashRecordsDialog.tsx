import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  IGetTrashItemRecordsVo,
  ITableTrashItemVo,
  ITrashItemRecordVo,
  IUserMapVo,
} from '@teable/openapi';
import { getTrashItemRecords } from '@teable/openapi';
import {
  RecordSnapshotExpandDialog,
  RecordSnapshotGrid,
  useRecordSnapshotFields,
} from '@teable/sdk/components';
import type { IGridRef, IRecordSnapshotSystemColumn } from '@teable/sdk/components';
import { BaseMultipleSelect } from '@teable/sdk/components/filter/view-filter/component/base';
import type { IDateRangeValue } from '@teable/sdk/components/filter/view-filter/component/filterDatePicker/DateRangePicker';
import { DateRangePicker } from '@teable/sdk/components/filter/view-filter/component/filterDatePicker/DateRangePicker';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useCollaboratorFilterUsers } from '@teable/sdk/hooks';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

const TRASH_TIME_FORMAT = 'YYYY/MM/DD HH:mm';

interface ITrashRecordsFilter {
  recordCreatedBy?: string[];
  recordCreatedTimeStart?: string;
  recordCreatedTimeEnd?: string;
}

interface ITrashRecordsDialogProps {
  tableId: string;
  trashItem: ITableTrashItemVo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const TrashRecordsDialog = (props: ITrashRecordsDialogProps) => {
  const { tableId, trashItem, open, onOpenChange } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const trashId = trashItem?.id;

  // The item stays set while the close animation plays; only `expandOpen` drives the dialog,
  // otherwise the closing dialog flashes empty.
  const [expandedItem, setExpandedItem] = useState<ITrashItemRecordVo | null>(null);
  const [expandOpen, setExpandOpen] = useState(false);

  const [createdByIds, setCreatedByIds] = useState<string[]>([]);
  const [createdDateRange, setCreatedDateRange] = useState<IDateRangeValue | null>(null);

  const filter = useMemo<ITrashRecordsFilter>(
    () => ({
      ...(createdByIds.length ? { recordCreatedBy: createdByIds } : {}),
      ...(createdDateRange?.exactDate
        ? { recordCreatedTimeStart: createdDateRange.exactDate }
        : {}),
      ...(createdDateRange?.exactDateEnd
        ? { recordCreatedTimeEnd: createdDateRange.exactDateEnd }
        : {}),
    }),
    [createdByIds, createdDateRange]
  );

  const fields = useRecordSnapshotFields(tableId, open);

  // Cursor-accumulate loading, same model as the archive grid: snapshots may come from
  // hot or cold storage, so pages walk a merged stream instead of windowing positions.
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getTrashItemRecords(trashId as string, { tableId, ...filter }),
    queryFn: ({ pageParam }) =>
      getTrashItemRecords(trashId as string, { tableId, ...filter, cursor: pageParam }).then(
        (res) => res.data
      ),
    enabled: Boolean(trashId) && open,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: IGetTrashItemRecordsVo) => lastPage.nextCursor ?? undefined,
  });

  const items = useMemo(() => (data ? data.pages.flatMap((page) => page.items) : []), [data]);

  const userMap = useMemo(() => {
    const map: IUserMapVo = {};
    data?.pages.forEach((page) => Object.assign(map, page.userMap));
    return map;
  }, [data]);

  const gridRef = useRef<IGridRef | null>(null);

  // A filter change resets the accumulated pages; the scroll position must follow,
  // otherwise the viewport sits past the shrunken row count.
  useEffect(() => {
    gridRef.current?.scrollTo(0, 0);
  }, [filter]);

  const { users: filterUsers, setUserSearch } = useCollaboratorFilterUsers({
    selectedIds: createdByIds,
    userMap,
  });

  const userOptions = useMemo(
    () => filterUsers.map((user) => ({ value: user.id, label: user.name })),
    [filterUsers]
  );

  const hasFilter = createdByIds.length > 0 || createdDateRange != null;

  const onFilterReset = useCallback(() => {
    setCreatedByIds([]);
    setCreatedDateRange(null);
    setUserSearch('');
  }, [setUserSearch]);

  const getTrashRecord = useCallback((item: ITrashItemRecordVo) => item.record, []);

  const getItem = useCallback((rowIndex: number) => items[rowIndex], [items]);

  const onLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const systemColumns = useMemo<IRecordSnapshotSystemColumn<ITrashItemRecordVo>[]>(
    () => [
      {
        id: '__deletedTime',
        name: t('table:tableTrash.deletedTime'),
        width: 150,
        getCellText: (item) => dayjs(item.deletedTime).format(TRASH_TIME_FORMAT),
      },
      {
        id: '__deletedBy',
        name: t('table:tableTrash.deletedBy'),
        width: 130,
        getCellText: (item) => userMap[item.deletedBy]?.name ?? '',
      },
    ],
    [t, userMap]
  );

  const onRowExpand = useCallback((item: ITrashItemRecordVo) => {
    setExpandedItem(item);
    setExpandOpen(true);
  }, []);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[90%] max-w-6xl flex-col gap-0 p-0">
          <DialogHeader className="border-b p-4">
            <DialogTitle>
              {t('table:tableTrash.recordsDialogTitle', {
                count: trashItem?.totalResourceCount ?? 0,
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-3">
            <BaseMultipleSelect
              value={createdByIds}
              options={userOptions}
              onSelect={setCreatedByIds}
              onSearch={setUserSearch}
              className="h-8 w-44"
              popoverClassName="w-72"
              placeholderClassName="text-xs"
              placeholder={t('table:tableTrash.filterAllCreators')}
              notFoundText={t('sdk:common.noRecords')}
              modal
            />
            <DateRangePicker
              value={createdDateRange}
              onChange={setCreatedDateRange}
              placeholder={t('table:tableTrash.filterCreatedTime')}
              className="h-8 w-52 text-xs"
              modal
            />
            {hasFilter && (
              <Button variant="outline" size="sm" onClick={onFilterReset}>
                {t('table:tableTrash.clearFilter')}
              </Button>
            )}
          </div>
          <RecordSnapshotGrid<ITrashItemRecordVo>
            fields={fields}
            rowCount={items.length}
            getItem={getItem}
            gridRef={gridRef}
            getRecord={getTrashRecord}
            systemColumns={systemColumns}
            isLoading={isLoading}
            onLoadMore={onLoadMore}
            emptyText={t('sdk:common.noRecords')}
            copySuccessText={t('table:table.actionTips.copySuccessful')}
            onRowExpand={onRowExpand}
          />
        </DialogContent>
      </Dialog>
      <RecordSnapshotExpandDialog
        open={expandOpen}
        onOpenChange={setExpandOpen}
        title={t('table:tableTrash.recordDetail')}
        meta={
          expandedItem && (
            <div className="text-xs text-muted-foreground">
              {t('table:tableTrash.deletedTime')}:{' '}
              {dayjs(expandedItem.deletedTime).format(TRASH_TIME_FORMAT)}
              {' · '}
              {t('table:tableTrash.deletedBy')}: {userMap[expandedItem.deletedBy]?.name ?? ''}
            </div>
          )
        }
        fields={fields}
        record={expandedItem?.record}
      />
    </>
  );
};
