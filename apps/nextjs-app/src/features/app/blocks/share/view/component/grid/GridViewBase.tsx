import { useMutation } from '@tanstack/react-query';
import type { GridViewOptions, IFilter, IGetRecordsRo } from '@teable-group/core';
import { RowHeightLevel, mergeFilter } from '@teable-group/core';
import type { IRangesRo } from '@teable-group/openapi';
import { shareViewCopy } from '@teable-group/openapi';
import type {
  CombinedSelection,
  ICell,
  ICellItem,
  IGridRef,
  IGroupPoint,
  IRectangle,
} from '@teable-group/sdk/components';
import {
  DraggableType,
  Grid,
  useGridAsyncRecords,
  useGridColumnResize,
  useGridColumnStatistics,
  useGridColumns,
  useGridIcons,
  useGridTheme,
  RowControlType,
  CellType,
  useGridGroupCollection,
  useGridCollapsedGroup,
  RowCounter,
  useGridColumnOrder,
} from '@teable-group/sdk/components';
import {
  useGroupPoint,
  useIsHydrated,
  useIsTouchDevice,
  useRowCount,
  useSSRRecord,
  useSSRRecords,
  useTableId,
  useView,
} from '@teable-group/sdk/hooks';
import { Skeleton, useToast } from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useClickAway } from 'react-use';
import { StatisticMenu } from '@/features/app/blocks/view/grid/components';
import { ExpandRecordContainer } from '@/features/app/components/ExpandRecordContainer';
import type { IExpandRecordContainerRef } from '@/features/app/components/ExpandRecordContainer/types';
import { GIRD_ROW_HEIGHT_DEFINITIONS } from '../../../../view/grid/const';
import { useCopy } from '../../../../view/grid/hooks';
import { useGridViewStore } from '../../../../view/grid/store/gridView';

export const GridViewBase = () => {
  const view = useView();
  const tableId = useTableId();
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const groupPoints = useGroupPoint();
  const prepare = isHydrated && view;
  const gridRef = useRef<IGridRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);
  const { toast } = useToast();
  const theme = useGridTheme();
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const ssrRecord = useSSRRecord();
  const isTouchDevice = useIsTouchDevice();
  const { setSelection, openStatisticMenu } = useGridViewStore();
  const { columns: originalColumns, cellValue2GridDisplay } = useGridColumns();
  const { columns, onColumnResize } = useGridColumnResize(originalColumns);
  const { columnStatistics } = useGridColumnStatistics(columns);
  const { onColumnOrdered } = useGridColumnOrder();

  const customIcons = useGridIcons();
  const { mutateAsync: copy } = useMutation({
    mutationFn: (copyRo: IRangesRo) => shareViewCopy(router.query.shareId as string, copyRo),
  });
  const copyMethod = useCopy({ copyReq: copy });
  const { filter, sort, group } = view ?? {};
  const realRowCount = rowCount ?? ssrRecords?.length ?? 0;

  const groupCollection = useGridGroupCollection();

  const { viewGroupQuery, collapsedGroupIds, onCollapsedGroupChanged } = useGridCollapsedGroup(
    `${tableId}-${view?.id}`,
    groupPoints
  );

  const viewQuery = useMemo(() => {
    const mergedFilter = mergeFilter(filter, viewGroupQuery?.filter);
    return {
      filter: mergedFilter as IFilter,
      orderBy: sort?.sortObjs as IGetRecordsRo['orderBy'],
      groupBy: group as IGetRecordsRo['groupBy'],
    };
  }, [filter, sort?.sortObjs, group, viewGroupQuery]);

  const { onVisibleRegionChanged, recordMap } = useGridAsyncRecords(
    ssrRecords,
    undefined,
    viewQuery
  );

  useClickAway(container, () => {
    gridRef.current?.resetState();
  });

  useEffect(() => {
    const recordIds = Object.keys(recordMap)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => recordMap[key]?.id)
      .filter(Boolean);
    expandRecordRef.current?.updateRecordIds?.(recordIds);
  }, [expandRecordRef, recordMap]);

  const onRowExpandInner = (rowIndex: number) => {
    const recordId = recordMap[rowIndex]?.id;
    if (!recordId) {
      return;
    }
    router.push(
      {
        pathname: `${router.pathname}/[recordId]`,
        query: { ...router.query, recordId },
      },
      undefined,
      {
        shallow: true,
      }
    );
  };

  const rowHeightLevel = useMemo(() => {
    if (view == null) return RowHeightLevel.Short;
    return (view.options as GridViewOptions)?.rowHeight || RowHeightLevel.Short;
  }, [view]);

  const onSelectionChanged = useCallback(
    (selection: CombinedSelection) => {
      setSelection(selection);
    },
    [setSelection]
  );

  const rowControls = useMemo(
    () => [
      {
        type: RowControlType.Checkbox,
        icon: RowControlType.Checkbox,
      },
      {
        type: RowControlType.Expand,
        icon: RowControlType.Expand,
      },
    ],
    []
  );

  const getCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [colIndex, rowIndex] = cell;
      const record = recordMap[rowIndex];
      if (record !== undefined) {
        const fieldId = columns[colIndex]?.id;
        if (!fieldId) return { type: CellType.Loading };
        return cellValue2GridDisplay(record, colIndex);
      }
      return { type: CellType.Loading };
    },
    [recordMap, columns, cellValue2GridDisplay]
  );

  const onCopy = useCallback(
    async (selection: CombinedSelection) => {
      const allowCopy = view?.shareMeta?.allowCopy;
      if (!allowCopy) {
        toast({ title: "Sorry, the table's owner has disabled copying" });
        return;
      }
      const toaster = toast({
        title: 'Copying...',
      });
      await copyMethod(selection);
      toaster.update({ id: toaster.id, title: 'Copied success!' });
    },
    [copyMethod, view?.shareMeta?.allowCopy, toast]
  );

  const onColumnStatisticClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      const { x, y, width, height } = bounds;
      const fieldId = columns[colIndex].id;
      openStatisticMenu({ fieldId, position: { x, y, width, height } });
    },
    [columns, openStatisticMenu]
  );

  return (
    <div ref={container} className="relative h-full w-full overflow-hidden">
      {prepare ? (
        <>
          <Grid
            ref={gridRef}
            theme={theme}
            draggable={DraggableType.Column}
            isTouchDevice={isTouchDevice}
            rowCount={realRowCount}
            rowHeight={GIRD_ROW_HEIGHT_DEFINITIONS[rowHeightLevel]}
            columnStatistics={columnStatistics}
            freezeColumnCount={isTouchDevice ? 0 : 1}
            columns={columns}
            smoothScrollX
            smoothScrollY
            customIcons={customIcons}
            rowControls={rowControls}
            style={{
              width: '100%',
              height: '100%',
            }}
            collapsedGroupIds={collapsedGroupIds}
            groupCollection={groupCollection}
            groupPoints={groupPoints as unknown as IGroupPoint[]}
            getCellContent={getCellContent}
            onVisibleRegionChanged={onVisibleRegionChanged}
            onSelectionChanged={onSelectionChanged}
            onCopy={onCopy}
            onRowExpand={onRowExpandInner}
            onColumnResize={onColumnResize}
            onColumnOrdered={onColumnOrdered}
            onColumnStatisticClick={onColumnStatisticClick}
            onCollapsedGroupChanged={onCollapsedGroupChanged}
          />
          <RowCounter rowCount={realRowCount} className="absolute bottom-3 left-0" />
        </>
      ) : (
        <div className="flex w-full items-center space-x-4">
          <div className="w-full space-y-3 px-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </div>
      )}
      <StatisticMenu />
      <ExpandRecordContainer ref={expandRecordRef} recordServerData={ssrRecord} />
    </div>
  );
};
