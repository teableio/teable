import type { PermissionAction } from '@teable/core';
import { RowHeightLevel, contractColorForTheme } from '@teable/core';
import type {
  IRectangle,
  IPosition,
  IGridRef,
  ICellItem,
  ICell,
  IInnerCell,
  Record,
  GridView,
  IGroupPoint,
} from '@teable/sdk';
import {
  Grid,
  CellType,
  RowControlType,
  SelectionRegionType,
  RegionType,
  DraggableType,
  CombinedSelection,
  useGridTheme,
  useGridColumnResize,
  useGridColumns,
  useGridColumnStatistics,
  useGridColumnOrder,
  useGridAsyncRecords,
  useGridIcons,
  useGridTooltipStore,
  hexToRGBA,
  emptySelection,
  useGridGroupCollection,
  useGridCollapsedGroup,
  RowCounter,
  generateLocalId,
  useGridPrefillingRow,
  SelectableType,
} from '@teable/sdk';
import { GRID_DEFAULT } from '@teable/sdk/components/grid/configs';
import { useScrollFrameRate } from '@teable/sdk/components/grid/hooks';
import {
  useFields,
  useGroupPoint,
  useIsTouchDevice,
  useRowCount,
  useSSRRecord,
  useSSRRecords,
  useTable,
  useTableId,
  useTablePermission,
  useView,
  useViewId,
} from '@teable/sdk/hooks';
import { Skeleton, useToast } from '@teable/ui-lib';
import { isEqual, keyBy, uniqueId, groupBy } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrevious, useMount, useClickAway } from 'react-use';
import { ExpandRecordContainer } from '@/features/app/components/ExpandRecordContainer';
import type { IExpandRecordContainerRef } from '@/features/app/components/ExpandRecordContainer/types';
import { tableConfig } from '@/features/i18n/table.config';
import { FieldOperator } from '../../../components/field-setting';
import { useFieldSettingStore } from '../field/useFieldSettingStore';
import { PrefillingRowContainer } from './components';
import { GIRD_ROW_HEIGHT_DEFINITIONS } from './const';
import { DomBox } from './DomBox';
import { useCollaborate, useSelectionOperation } from './hooks';
import { useGridViewStore } from './store/gridView';

interface IGridViewProps {
  onRowExpand?: (recordId: string) => void;
}

const { scrollBuffer, columnAppendBtnWidth } = GRID_DEFAULT;

export const GridViewBase: React.FC<IGridViewProps> = (props: IGridViewProps) => {
  const { onRowExpand } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const router = useRouter();
  const gridRef = useRef<IGridRef>(null);
  const prefillingGridRef = useRef<IGridRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);
  const tableId = useTableId() as string;
  const table = useTable();
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const rowCount = useRowCount();
  const groupPoints = useGroupPoint();
  const ssrRecords = useSSRRecords();
  const ssrRecord = useSSRRecord();
  const theme = useGridTheme();
  const fields = useFields();
  const { columns: originalColumns, cellValue2GridDisplay } = useGridColumns();
  const { columns, onColumnResize } = useGridColumnResize(originalColumns);
  const { columnStatistics } = useGridColumnStatistics(columns);
  const { onColumnOrdered } = useGridColumnOrder();
  const { openRecordMenu, openHeaderMenu, openStatisticMenu, setSelection, selection } =
    useGridViewStore();
  const { openSetting } = useFieldSettingStore();
  const { openTooltip, closeTooltip } = useGridTooltipStore();
  const preTableId = usePrevious(tableId);
  const isTouchDevice = useIsTouchDevice();
  const [isReadyToRender, setReadyToRender] = useState(false);
  const sort = view?.sort;
  const group = view?.group;
  const isAutoSort = sort && !sort?.manualSort;
  const frozenColumnCount = isTouchDevice ? 0 : view?.options?.frozenColumnCount ?? 1;
  const isLoading = !view;
  const permission = useTablePermission();
  const { toast } = useToast();
  const realRowCount = rowCount ?? ssrRecords?.length ?? 0;

  const groupCollection = useGridGroupCollection();

  const { viewGroupQuery, collapsedGroupIds, onCollapsedGroupChanged } = useGridCollapsedGroup(
    generateLocalId(tableId, activeViewId),
    groupPoints
  );

  const { onVisibleRegionChanged, onRowOrdered, onReset, recordMap } = useGridAsyncRecords(
    ssrRecords,
    undefined,
    viewGroupQuery
  );

  const { copy, paste, clear } = useSelectionOperation(viewGroupQuery?.filter);

  const {
    prefillingRowIndex,
    prefillingRecordId,
    isRowPrefillingActived,
    setPrefillingRowIndex,
    setPrefillingRecordId,
    onPrefillingCellEdited,
    getPrefillingCellContent,
  } = useGridPrefillingRow(columns);

  const inPrefilling = prefillingRowIndex != null;

  useEffect(() => {
    if (preTableId && preTableId !== tableId) {
      onReset();
    }
  }, [onReset, tableId, preTableId]);

  useEffect(() => {
    const recordIds = Object.keys(recordMap)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => recordMap[key]?.id)
      .filter(Boolean);
    expandRecordRef.current?.updateRecordIds?.(recordIds);
  }, [recordMap]);

  // The recordId on the route changes, and the activeCell needs to change with it
  useEffect(() => {
    const recordId = router.query.recordId as string;
    if (recordId && isReadyToRender) {
      const recordIndex = Number(
        Object.keys(recordMap).find((key) => recordMap[key]?.id === recordId)
      );

      if (recordId === prefillingRecordId) {
        return prefillingGridRef.current?.setSelection(
          new CombinedSelection(SelectionRegionType.Cells, [
            [0, 0],
            [0, 0],
          ])
        );
      }

      recordIndex >= 0 &&
        gridRef.current?.setSelection(
          new CombinedSelection(SelectionRegionType.Cells, [
            [0, recordIndex],
            [0, recordIndex],
          ])
        );
    }
  }, [router.query.recordId, recordMap, isReadyToRender, prefillingRecordId]);

  useMount(() => setReadyToRender(true));

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

  const onCellEdited = useCallback(
    (cell: ICellItem, newVal: IInnerCell) => {
      const [, row] = cell;
      const record = recordMap[row];
      if (record === undefined) return;

      const [col] = cell;
      const fieldId = columns[col].id;
      const { type, data } = newVal;
      let newCellValue: unknown = null;

      switch (type) {
        case CellType.Select:
          newCellValue = data?.length ? data : null;
          break;
        case CellType.Text:
        case CellType.Number:
        case CellType.Boolean:
        default:
          newCellValue = data === '' ? null : data;
      }
      const oldCellValue = record.getCellValue(fieldId) ?? null;
      if (isEqual(newCellValue, oldCellValue)) return;
      record.updateCell(fieldId, newCellValue);
      return record;
    },
    [recordMap, columns]
  );

  const callbackForPrefilling = useCallback(
    (recordId: string, targetIndex?: number) => {
      if (!isRowPrefillingActived) return;
      const index = targetIndex ?? Math.max(realRowCount - 1, 0);
      setPrefillingRowIndex(index);
      setPrefillingRecordId(recordId);
      setSelection(emptySelection);
      gridRef.current?.setSelection(emptySelection);
    },
    [
      isRowPrefillingActived,
      realRowCount,
      setPrefillingRowIndex,
      setPrefillingRecordId,
      setSelection,
    ]
  );

  const createRecordWithCallback = (
    fieldValueMap: { [fieldId: string]: unknown },
    targetIndex?: number
  ) => {
    return table?.createRecord(fieldValueMap).then((res) => {
      const record = res.data.records[0];
      if (record == null) return;
      callbackForPrefilling(record.id, targetIndex);
    });
  };

  const onContextMenu = useCallback(
    // eslint-disable-next-line sonarjs/cognitive-complexity
    (selection: CombinedSelection, position: IPosition) => {
      const { isCellSelection, isRowSelection, isColumnSelection, ranges } = selection;

      function extract<T>(_start: number, _end: number, source: T[] | { [key: number]: T }): T[] {
        const start = Math.min(_start, _end);
        const end = Math.max(_start, _end);
        return Array.from({ length: end - start + 1 })
          .map((_, index) => {
            return source[start + index];
          })
          .filter(Boolean);
      }

      if (isCellSelection || isRowSelection) {
        const rowStart = isCellSelection ? ranges[0][1] : ranges[0][0];
        const rowEnd = isCellSelection ? ranges[1][1] : ranges[0][1];
        const colStart = isCellSelection ? ranges[0][0] : 0;
        const colEnd = isCellSelection ? ranges[1][0] : columns.length - 1;
        const records = extract(rowStart, rowEnd, recordMap);
        const selectColumns = extract(colStart, colEnd, columns);
        const indexedColumns = keyBy(selectColumns, 'id');
        const selectFields = fields.filter((field) => indexedColumns[field.id]);
        const neighborRecords: Array<Record | null> = [];

        if (records.length === 1) {
          neighborRecords[0] = rowStart === 0 ? null : recordMap[rowStart - 1];
          neighborRecords[1] = rowStart >= realRowCount - 1 ? null : recordMap[rowStart + 1];
        }

        openRecordMenu({
          position,
          records,
          fields: selectFields,
          neighborRecords,
          onAfterInsertCallback: callbackForPrefilling,
        });
      }

      if (isColumnSelection) {
        const [start, end] = ranges[0];
        const selectColumns = extract(start, end, columns);
        const indexedColumns = keyBy(selectColumns, 'id');
        const selectFields = fields.filter((field) => indexedColumns[field.id]);
        openHeaderMenu({ position, fields: selectFields });
      }
    },
    [
      columns,
      recordMap,
      fields,
      realRowCount,
      openRecordMenu,
      openHeaderMenu,
      callbackForPrefilling,
    ]
  );

  const onColumnHeaderMenuClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      const fieldId = columns[colIndex].id;
      const { x, height } = bounds;
      const selectedFields = fields.filter((field) => field.id === fieldId);
      openHeaderMenu({ fields: selectedFields, position: { x, y: height } });
    },
    [columns, fields, openHeaderMenu]
  );

  const onColumnHeaderDblClick = useCallback(
    (colIndex: number) => {
      const fieldId = columns[colIndex].id;
      gridRef.current?.setSelection(emptySelection);
      openSetting({ fieldId, operator: FieldOperator.Edit });
    },
    [columns, openSetting]
  );

  const onColumnHeaderClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      if (!isTouchDevice) return;
      const fieldId = columns[colIndex].id;
      const { x, height } = bounds;
      const selectedFields = fields.filter((field) => field.id === fieldId);
      openHeaderMenu({ fields: selectedFields, position: { x, y: height } });
    },
    [isTouchDevice, columns, fields, openHeaderMenu]
  );

  const onColumnStatisticClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      const { x, y, width, height } = bounds;
      const fieldId = columns[colIndex].id;
      openStatisticMenu({ fieldId, position: { x, y, width, height } });
    },
    [columns, openStatisticMenu]
  );

  const onColumnFreeze = useCallback(
    (count: number) => {
      view?.updateFrozenColumnCount(count);
    },
    [view]
  );

  const onRowAppend = (targetIndex?: number) => {
    if (group?.length && targetIndex != null) {
      const record = recordMap[targetIndex];

      if (record == null) return createRecordWithCallback({}, targetIndex);

      const fieldValueMap = group.reduce(
        (prev, { fieldId }) => {
          prev[fieldId] = record.getCellValue(fieldId);
          return prev;
        },
        {} as { [key: string]: unknown }
      );
      return createRecordWithCallback(fieldValueMap, targetIndex);
    }
    return createRecordWithCallback({}, targetIndex);
  };

  const onColumnAppend = () => {
    openSetting({
      operator: FieldOperator.Add,
    });
  };

  const customIcons = useGridIcons();

  const rowHeight = useMemo(() => {
    if (view == null) return GIRD_ROW_HEIGHT_DEFINITIONS[RowHeightLevel.Short];
    return GIRD_ROW_HEIGHT_DEFINITIONS[view.options?.rowHeight || RowHeightLevel.Short];
  }, [view]);

  const rowControls = useMemo(() => {
    if (isTouchDevice) return [];
    const drag = permission['view|update']
      ? [
          {
            type: RowControlType.Drag,
            icon: RowControlType.Drag,
          },
        ]
      : [];
    return [
      ...drag,
      {
        type: RowControlType.Checkbox,
        icon: RowControlType.Checkbox,
      },
      {
        type: RowControlType.Expand,
        icon: RowControlType.Expand,
      },
    ];
  }, [isTouchDevice, permission]);

  const onDelete = (selection: CombinedSelection) => {
    clear(selection);
  };

  const onCopy = async (selection: CombinedSelection) => {
    copy(selection);
  };
  const onPaste = (selection: CombinedSelection, e: React.ClipboardEvent) => {
    if (!permission['record|update']) {
      toast({ title: 'Unable to paste' });
    }
    paste(selection, e, recordMap);
  };

  const onSelectionChanged = useCallback(
    (selection: CombinedSelection) => {
      setSelection(selection);
    },
    [setSelection]
  );

  const collaborators = useCollaborate(selection, getCellContent);

  const groupedCollaborators = useMemo(() => {
    return groupBy(collaborators, 'activeCell');
  }, [collaborators]);

  const onRowExpandInner = (rowIndex: number) => {
    const recordId = recordMap[rowIndex]?.id;
    if (!recordId) {
      return;
    }
    if (onRowExpand) {
      onRowExpand(recordId);
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

  const onPrefillingRowExpand = (_rowIndex: number) => {
    if (!prefillingRecordId) return;

    if (onRowExpand) {
      onRowExpand(prefillingRecordId);
      return;
    }
    router.push(
      {
        pathname: router.pathname,
        query: { ...router.query, recordId: prefillingRecordId },
      },
      undefined,
      {
        shallow: true,
      }
    );
  };

  const onItemClick = (type: RegionType, bounds: IRectangle, cellItem: ICellItem) => {
    const [columnIndex] = cellItem;
    const { id: fieldId } = columns[columnIndex] ?? {};

    if (type === RegionType.ColumnDescription) {
      openSetting({ fieldId, operator: FieldOperator.Edit });
    }
  };

  const componentId = useMemo(() => uniqueId('grid-view-'), []);

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

    if (type === RegionType.RowHeaderDragHandler && isAutoSort) {
      openTooltip({
        id: componentId,
        text: t('table:view.dragToolTip'),
        position: bounds,
      });
    }

    if ([RegionType.Cell, RegionType.ActiveCell].includes(type) && collaborators.length) {
      const { x, y, width, height } = bounds;
      const cellInfo = getCellContent(cellItem);
      if (!cellInfo?.id) {
        return;
      }
      const [recordId, fieldId] = cellInfo.id.split('-');
      const hoverCollaborators = groupedCollaborators?.[`${recordId},${fieldId}`]?.sort(
        (a, b) => a.timeStamp - b.timeStamp
      );
      const collaboratorText = hoverCollaborators?.map((cur) => cur.user.name).join('、');

      const hoverHeight = 24;

      collaboratorText &&
        openTooltip?.({
          id: componentId,
          text: collaboratorText,
          position: {
            x: x,
            y: y + 9,
            width: width,
            height: height,
          },
          contentClassName:
            'items-center py-0 px-2 absolute truncate whitespace-nowrap rounded-t-md',
          contentStyle: {
            right: `-${width / 2}px`,
            top: `-${hoverHeight}px`,
            maxWidth: width - 1,
            height: `${hoverHeight}px`,
            direction: 'rtl',
            lineHeight: `${hoverHeight}px`,
            // multiple collaborators only display the latest one
            backgroundColor: hexToRGBA(
              contractColorForTheme(
                hoverCollaborators.slice(-1)[0].borderColor,
                theme.themeKey ?? 'light'
              )
            ),
          },
        });
    }
  };

  const draggable = useMemo(() => {
    if (isAutoSort) return DraggableType.Column;
    return DraggableType.All;
  }, [isAutoSort]);

  const getAuthorizedFunction = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T extends (...args: any[]) => any>(
      fn: T,
      permissionAction: PermissionAction
    ): T | undefined => {
      return permission[permissionAction] ? fn : undefined;
    },
    [permission]
  );

  const onGridScrollChanged = useCallback((sl?: number, _st?: number) => {
    prefillingGridRef.current?.scrollTo(sl, undefined);
  }, []);

  const onPrefillingGridScrollChanged = useCallback((sl?: number, _st?: number) => {
    gridRef.current?.scrollTo(sl, undefined);
  }, []);

  const prefillingRowStyle = useMemo(() => {
    const defaultTop = rowHeight / 2;
    const height = rowHeight + 5;

    if (gridRef.current == null || prefillingRowIndex == null) {
      return { top: defaultTop, height };
    }
    return {
      top: gridRef.current.getRowOffset(prefillingRowIndex) + defaultTop,
      height,
    };
  }, [rowHeight, prefillingRowIndex]);

  useEffect(() => {
    if (!inPrefilling) return;
    const scrollState = gridRef.current?.getScrollState();
    if (scrollState == null) return;
    prefillingGridRef.current?.scrollTo(scrollState.scrollLeft, undefined);
  }, [inPrefilling]);

  useClickAway(containerRef, () => {
    gridRef.current?.resetState();
  });

  useEffect(() => {
    if (!selection) {
      return;
    }
    const handleFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        gridRef.current?.resetState();
      }
    };
    document.addEventListener('focus', handleFocus, true);
    return () => {
      document.removeEventListener('focus', handleFocus, true);
    };
  }, [selection]);

  useScrollFrameRate(gridRef.current?.scrollBy);

  return (
    <div ref={containerRef} className="relative size-full overflow-hidden">
      {isReadyToRender && !isLoading ? (
        <>
          <Grid
            ref={gridRef}
            theme={theme}
            style={{ pointerEvents: inPrefilling ? 'none' : 'auto' }}
            draggable={draggable}
            isTouchDevice={isTouchDevice}
            rowCount={realRowCount}
            rowHeight={rowHeight}
            freezeColumnCount={frozenColumnCount}
            columnStatistics={columnStatistics}
            columns={columns}
            customIcons={customIcons}
            rowControls={rowControls}
            collapsedGroupIds={collapsedGroupIds}
            groupCollection={groupCollection}
            groupPoints={groupPoints as unknown as IGroupPoint[]}
            collaborators={collaborators}
            getCellContent={getCellContent}
            onDelete={getAuthorizedFunction(onDelete, 'record|update')}
            onRowOrdered={onRowOrdered}
            onRowExpand={onRowExpandInner}
            onRowAppend={getAuthorizedFunction(onRowAppend, 'record|create')}
            onCellEdited={getAuthorizedFunction(onCellEdited, 'record|update')}
            onColumnAppend={getAuthorizedFunction(onColumnAppend, 'field|create')}
            onColumnFreeze={getAuthorizedFunction(onColumnFreeze, 'view|update')}
            onColumnResize={getAuthorizedFunction(onColumnResize, 'field|update')}
            onColumnOrdered={getAuthorizedFunction(onColumnOrdered, 'field|update')}
            onContextMenu={onContextMenu}
            onColumnHeaderClick={onColumnHeaderClick}
            onColumnStatisticClick={getAuthorizedFunction(onColumnStatisticClick, 'view|update')}
            onVisibleRegionChanged={onVisibleRegionChanged}
            onSelectionChanged={onSelectionChanged}
            onColumnHeaderDblClick={onColumnHeaderDblClick}
            onColumnHeaderMenuClick={onColumnHeaderMenuClick}
            onCollapsedGroupChanged={onCollapsedGroupChanged}
            onScrollChanged={onGridScrollChanged}
            onCopy={onCopy}
            onPaste={onPaste}
            onItemClick={onItemClick}
            onItemHovered={onItemHovered}
          />
          {inPrefilling && (
            <PrefillingRowContainer
              style={prefillingRowStyle}
              onClickOutside={() => {
                setPrefillingRowIndex(undefined);
                setPrefillingRecordId(undefined);
              }}
            >
              <Grid
                ref={prefillingGridRef}
                theme={theme}
                scrollBufferX={
                  permission['field|create'] ? scrollBuffer + columnAppendBtnWidth : scrollBuffer
                }
                scrollBufferY={0}
                scrollBarVisible={false}
                rowCount={1}
                rowHeight={rowHeight}
                rowIndexVisible={false}
                rowControls={rowControls}
                draggable={DraggableType.None}
                selectable={SelectableType.Cell}
                columns={columns}
                columnHeaderVisible={false}
                freezeColumnCount={frozenColumnCount}
                customIcons={customIcons}
                onRowExpand={onPrefillingRowExpand}
                getCellContent={getPrefillingCellContent}
                onScrollChanged={onPrefillingGridScrollChanged}
                onCellEdited={getAuthorizedFunction(onPrefillingCellEdited, 'record|update')}
              />
            </PrefillingRowContainer>
          )}
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
      <DomBox id={componentId} />
      {!onRowExpand && <ExpandRecordContainer ref={expandRecordRef} recordServerData={ssrRecord} />}
    </div>
  );
};
