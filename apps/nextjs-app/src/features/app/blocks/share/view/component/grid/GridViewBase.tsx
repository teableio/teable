import { useMutation } from '@tanstack/react-query';
import type { IGridViewOptions, IFilter } from '@teable/core';
import { RowHeightLevel, mergeFilter } from '@teable/core';
import type { IGetRecordsRo, IRangesRo } from '@teable/openapi';
import { shareViewCopy } from '@teable/openapi';
import type {
  CombinedSelection,
  ICell,
  ICellItem,
  IGridRef,
  IGroupPoint,
  IRectangle,
} from '@teable/sdk/components';
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
  generateLocalId,
} from '@teable/sdk/components';
import {
  useGroupPoint,
  useIsHydrated,
  useIsTouchDevice,
  useRowCount,
  useSSRRecord,
  useSSRRecords,
  useTableId,
  useView,
} from '@teable/sdk/hooks';
import { Skeleton, useToast } from '@teable/ui-lib/shadcn';
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
  const { selection, setSelection, openStatisticMenu } = useGridViewStore();
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
    generateLocalId(tableId, view?.id),
    groupPoints
  );

  const viewQuery = useMemo(() => {
    const mergedFilter = mergeFilter(filter, viewGroupQuery?.filter);
    return {
      filter: mergedFilter as IFilter,
      orderBy: sort?.sortObjs as IGetRecordsRo['orderBy'],
      groupBy: group as IGetRecordsRo['groupBy'],
    };
  }, [filter, viewGroupQuery?.filter, sort?.sortObjs, group]);

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
        pathname: router.pathname,
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
    return (view.options as IGridViewOptions)?.rowHeight || RowHeightLevel.Short;
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

  useEffect(() => {
    if (!selection) {
      return;
    }
    const handleFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (container.current && !container.current.contains(target)) {
        gridRef.current?.resetState();
      }
    };
    document.addEventListener('focus', handleFocus, true);
    return () => {
      document.removeEventListener('focus', handleFocus, true);
    };
  }, [selection]);

  return (
    <div ref={container} className="relative size-full overflow-hidden">
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
