import { useMutation } from '@tanstack/react-query';
import type { IGridViewOptions } from '@teable/core';
import { RowHeightLevel } from '@teable/core';
import type { IGetRecordsRo, IGroupPointsVo, IRangesRo } from '@teable/openapi';
import { saveQueryParams, shareViewCopy } from '@teable/openapi';
import type {
  CombinedSelection,
  IButtonCell,
  ICell,
  ICellItem,
  IGridRef,
  IGroupPoint,
  IPosition,
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
  useGridTooltipStore,
  RegionType,
  useGridViewStore,
  LARGE_QUERY_THRESHOLD,
} from '@teable/sdk/components';
import {
  useButtonClickStatus,
  useFields,
  useIsHydrated,
  useIsTouchDevice,
  useRowCount,
  useSSRRecord,
  useSSRRecords,
  useSearch,
  useTableId,
  useView,
} from '@teable/sdk/hooks';
import { Skeleton, useToast } from '@teable/ui-lib/shadcn';
import { uniqueId } from 'lodash';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useClickAway } from 'react-use';
import { DomBox } from '@/features/app/blocks/view/grid/DomBox';
import { useGridSearchStore } from '@/features/app/blocks/view/grid/useGridSearchStore';
import { ExpandRecordContainer } from '@/features/app/components/expand-record-container';
import type { IExpandRecordContainerRef } from '@/features/app/components/expand-record-container/types';
import { tableConfig } from '@/features/i18n/table.config';
import {
  GIRD_FIELD_NAME_HEIGHT_DEFINITIONS,
  GIRD_ROW_HEIGHT_DEFINITIONS,
} from '../../../../view/grid/const';
import { useSelectionOperation } from '../../../../view/grid/hooks';

interface IGridViewProps {
  groupPointsServerData?: IGroupPointsVo;
}

export const GridViewBase = (props: IGridViewProps) => {
  const { groupPointsServerData } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const view = useView();
  const tableId = useTableId() as string;
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const gridRef = useRef<IGridRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);
  const { toast } = useToast();
  const theme = useGridTheme();
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const ssrRecord = useSSRRecord();
  const isTouchDevice = useIsTouchDevice();
  const { setSelection, openStatisticMenu, openGroupHeaderMenu } = useGridViewStore();
  const { columns: originalColumns, cellValue2GridDisplay } = useGridColumns();
  const { columns, onColumnResize } = useGridColumnResize(originalColumns);
  const { columnStatistics } = useGridColumnStatistics(columns);
  const { onColumnOrdered } = useGridColumnOrder();
  const { searchQuery: search } = useSearch();
  const visibleFields = useFields();
  const customIcons = useGridIcons();
  const { openTooltip, closeTooltip } = useGridTooltipStore();
  const { setGridRef, searchCursor } = useGridSearchStore();
  const buttonClickStatusHook = useButtonClickStatus(tableId, router.query.shareId as string);

  const prepare = isHydrated && view && columns.length;
  const { filter, sort } = view ?? {};
  const realRowCount = rowCount ?? ssrRecords?.length ?? 0;
  const rowHeight =
    GIRD_ROW_HEIGHT_DEFINITIONS[
      (view?.options as IGridViewOptions)?.rowHeight ?? RowHeightLevel.Short
    ];
  const columnHeaderHeight =
    GIRD_FIELD_NAME_HEIGHT_DEFINITIONS[
      (view?.options as IGridViewOptions)?.fieldNameDisplayLines ?? 1
    ];

  const groupCollection = useGridGroupCollection();

  useEffect(() => {
    setGridRef(gridRef);
  }, [setGridRef]);

  const {
    viewQuery: viewQueryWithGroup,
    collapsedGroupIds,
    onCollapsedGroupChanged,
  } = useGridCollapsedGroup(generateLocalId(tableId, view?.id));

  const { mutateAsync: copyReq } = useMutation({
    mutationFn: async (copyRo: IRangesRo) => {
      const shareId = router.query.shareId as string;
      const collapsedGroupIds = viewQueryWithGroup?.collapsedGroupIds;
      const { collapsedGroupIds: originalCollapsedGroupIds, ...rest } = copyRo;
      const params = {
        ...rest,
        orderBy: view?.sort?.sortObjs,
        groupBy: view?.group,
        filter: view?.filter,
        search,
        projection: visibleFields.map((field) => field.id),
      };
      if (collapsedGroupIds && collapsedGroupIds.length > LARGE_QUERY_THRESHOLD) {
        const { data } = await saveQueryParams({ params: { collapsedGroupIds } });
        return shareViewCopy(shareId, { ...params, queryId: data.queryId });
      }
      return shareViewCopy(shareId, { ...params, collapsedGroupIds });
    },
  });
  const { copy } = useSelectionOperation({
    copyReq,
    collapsedGroupIds: collapsedGroupIds ? Array.from(collapsedGroupIds) : undefined,
  });

  const viewQuery = useMemo(() => {
    return {
      filter,
      orderBy: sort?.sortObjs as IGetRecordsRo['orderBy'],
      ...viewQueryWithGroup,
    };
  }, [filter, sort?.sortObjs, viewQueryWithGroup]);

  const { recordMap, groupPoints, searchHitIndex, allGroupHeaderRefs, onVisibleRegionChanged } =
    useGridAsyncRecords(ssrRecords, undefined, viewQuery, groupPointsServerData);

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

  const onSelectionChanged = useCallback(
    (selection: CombinedSelection) => {
      setSelection(selection);
    },
    [setSelection]
  );

  const onColumnFreeze = useCallback(
    (count: number) => {
      view?.updateOption({ frozenColumnCount: count });
    },
    [view]
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
        return cellValue2GridDisplay(record, colIndex, false, undefined, buttonClickStatusHook);
      }
      return { type: CellType.Loading };
    },
    [recordMap, columns, cellValue2GridDisplay, buttonClickStatusHook]
  );

  const onCopy = useCallback(
    async (selection: CombinedSelection) => {
      const allowCopy = view?.shareMeta?.allowCopy;
      if (!allowCopy) {
        toast({ title: "Sorry, the table's owner has disabled copying" });
        return;
      }
      await copy(selection);
    },
    [copy, view?.shareMeta?.allowCopy, toast]
  );

  const onColumnStatisticClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      const { x, y, width, height } = bounds;
      const fieldId = columns[colIndex].id;
      openStatisticMenu({ fieldId, position: { x, y, width, height } });
    },
    [columns, openStatisticMenu]
  );

  const onCellValueHovered = (bounds: IRectangle, cellItem: ICellItem) => {
    const cellInfo = getCellContent(cellItem);
    if (!cellInfo?.id) {
      return;
    }

    if (cellInfo.type === CellType.Button) {
      const { data } = cellInfo as IButtonCell;
      const { fieldOptions, cellValue } = data;
      const { label } = fieldOptions;
      const count = cellValue?.count ?? 0;
      const maxCount = fieldOptions?.maxCount ?? 0;
      openTooltip({
        id: componentId,
        text: t('sdk:common.clickedCount', {
          label,
          text: maxCount > 0 ? `${count}/${maxCount}` : `${count}`,
        }),
        position: bounds,
      });
    }
  };

  const componentId = useMemo(() => uniqueId('shared-grid-view-'), []);

  const onItemHovered = (type: RegionType, bounds: IRectangle, cellItem: ICellItem) => {
    const [columnIndex] = cellItem;
    const { description } = columns[columnIndex] ?? {};

    closeTooltip();

    if (type === RegionType.ColumnDescription && description) {
      openTooltip({
        id: componentId,
        text: description,
        position: bounds,
      });
    }

    if (type === RegionType.CellValue) {
      onCellValueHovered(bounds, cellItem);
    }
  };

  const onGroupHeaderContextMenu = (groupId: string, position: IPosition) => {
    openGroupHeaderMenu({
      groupId,
      position,
      allGroupHeaderRefs,
    });
  };

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
            rowHeight={rowHeight}
            columnHeaderHeight={columnHeaderHeight}
            columnStatistics={columnStatistics}
            freezeColumnCount={
              isTouchDevice ? 0 : (view?.options as IGridViewOptions)?.frozenColumnCount ?? 1
            }
            columns={columns}
            searchCursor={searchCursor}
            searchHitIndex={searchHitIndex}
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
            onItemHovered={onItemHovered}
            onRowExpand={onRowExpandInner}
            onColumnResize={onColumnResize}
            onColumnFreeze={onColumnFreeze}
            onColumnOrdered={onColumnOrdered}
            onColumnStatisticClick={onColumnStatisticClick}
            onCollapsedGroupChanged={onCollapsedGroupChanged}
            onGroupHeaderContextMenu={onGroupHeaderContextMenu}
          />
          <RowCounter rowCount={realRowCount} className="absolute bottom-3 left-0" />
        </>
      ) : (
        <div className="flex w-full items-center space-x-4">
          <div className="w-full space-y-3 px-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        </div>
      )}
      <DomBox id={componentId} />
      <ExpandRecordContainer
        ref={expandRecordRef}
        recordServerData={ssrRecord}
        buttonClickStatusHook={buttonClickStatusHook}
      />
    </div>
  );
};
