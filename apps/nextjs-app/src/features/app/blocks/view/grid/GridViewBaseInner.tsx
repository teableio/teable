import { useMutation } from '@tanstack/react-query';
import type { IFieldVo } from '@teable/core';
import {
  FieldKeyType,
  RowHeightLevel,
  contractColorForTheme,
  fieldVoSchema,
  stringifyClipboardText,
} from '@teable/core';
import type { ICreateRecordsRo, IGroupPointsVo, IUpdateOrderRo } from '@teable/openapi';
import { createRecords } from '@teable/openapi';
import type {
  IRectangle,
  IPosition,
  IGridRef,
  ICellItem,
  ICell,
  IInnerCell,
  GridView,
  IGroupPoint,
  IUseTablePermissionAction,
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
  useCommentCountMap,
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
  useGridRowOrder,
  ExpandRecorder,
  useGridViewStore,
  useGridSelection,
  Record,
  DragRegionType,
} from '@teable/sdk';
import { GRID_DEFAULT } from '@teable/sdk/components/grid/configs';
import { useScrollFrameRate } from '@teable/sdk/components/grid/hooks';
import {
  useFieldCellEditable,
  useFields,
  useIsTouchDevice,
  useRowCount,
  useSSRRecord,
  useSSRRecords,
  useTableId,
  useTablePermission,
  useUndoRedo,
  useView,
  useViewId,
} from '@teable/sdk/hooks';
import { useToast } from '@teable/ui-lib';
import { isEqual, keyBy, uniqueId, groupBy } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { usePrevious, useClickAway } from 'react-use';
import { ExpandRecordContainer } from '@/features/app/components/ExpandRecordContainer';
import type { IExpandRecordContainerRef } from '@/features/app/components/ExpandRecordContainer/types';
import { tableConfig } from '@/features/i18n/table.config';
import { FieldOperator } from '../../../components/field-setting';
import { useFieldSettingStore } from '../field/useFieldSettingStore';
import { PrefillingRowContainer, PresortRowContainer } from './components';
import type { IConfirmNewRecordsRef } from './components/ConfirmNewRecords';
import { ConfirmNewRecords } from './components/ConfirmNewRecords';
import { GIRD_ROW_HEIGHT_DEFINITIONS } from './const';
import { DomBox } from './DomBox';
import { useCollaborate, useSelectionOperation } from './hooks';
import { useIsSelectionLoaded } from './hooks/useIsSelectionLoaded';
import { useGridSearchStore } from './useGridSearchStore';

interface IGridViewBaseInnerProps {
  groupPointsServerData?: IGroupPointsVo;
  onRowExpand?: (recordId: string) => void;
}

const { scrollBuffer, columnAppendBtnWidth } = GRID_DEFAULT;

export const GridViewBaseInner: React.FC<IGridViewBaseInnerProps> = (
  props: IGridViewBaseInnerProps
) => {
  const { groupPointsServerData, onRowExpand } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const router = useRouter();
  const tableId = useTableId() as string;
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const rowCount = useRowCount();
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
  const sort = view?.sort;
  const group = view?.group;
  const isAutoSort = sort && !sort?.manualSort;
  const frozenColumnCount = isTouchDevice ? 0 : view?.options?.frozenColumnCount ?? 1;
  const permission = useTablePermission();
  const { toast } = useToast();
  const realRowCount = rowCount ?? ssrRecords?.length ?? 0;
  const fieldEditable = useFieldCellEditable();
  const { undo, redo } = useUndoRedo();
  const { setGridRef, searchCursor } = useGridSearchStore();
  const [expandRecord, setExpandRecord] = useState<{ tableId: string; recordId: string }>();
  const [newRecords, setNewRecords] = useState<ICreateRecordsRo['records']>();

  const gridRef = useRef<IGridRef>(null);
  const presortGridRef = useRef<IGridRef>(null);
  const prefillingGridRef = useRef<IGridRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);
  const confirmNewRecordsRef = useRef<IConfirmNewRecordsRef>(null);

  const groupCollection = useGridGroupCollection();

  const { viewQuery, collapsedGroupIds, onCollapsedGroupChanged } = useGridCollapsedGroup(
    generateLocalId(tableId, activeViewId)
  );

  const { onVisibleRegionChanged, onReset, recordMap, groupPoints, recordsQuery, searchHitIndex } =
    useGridAsyncRecords(ssrRecords, undefined, viewQuery, groupPointsServerData);

  const isSelectionLoaded = useIsSelectionLoaded();

  const commentCountMap = useCommentCountMap(recordsQuery);

  const { onRowOrdered, setDraggingRecordIds } = useGridRowOrder(recordMap);

  const { copy, paste, clear, deleteRecords, syncCopy } = useSelectionOperation({
    collapsedGroupIds: viewQuery?.collapsedGroupIds
      ? Array.from(viewQuery?.collapsedGroupIds)
      : undefined,
  });

  const {
    presortRecord,
    onSelectionChanged,
    presortRecordData,
    onPresortCellEdited,
    getPresortCellContent,
    setPresortRecordData,
  } = useGridSelection({ recordMap, columns, viewQuery, gridRef });

  const {
    localRecord,
    prefillingRowIndex,
    prefillingRowOrder,
    prefillingFieldValueMap,
    setPrefillingRowIndex,
    setPrefillingRowOrder,
    onPrefillingCellEdited,
    getPrefillingCellContent,
    setPrefillingFieldValueMap,
  } = useGridPrefillingRow(columns);

  const { mutate: mutateCreateRecord, isLoading: isCreatingRecord } = useMutation({
    mutationFn: (records: ICreateRecordsRo['records']) =>
      createRecords(tableId!, {
        records,
        fieldKeyType: FieldKeyType.Id,
        order:
          activeViewId && prefillingRowOrder
            ? { ...prefillingRowOrder, viewId: activeViewId }
            : undefined,
      }),
    onSuccess: () => {
      resetNewRecords();
    },
  });

  const resetNewRecords = () => {
    setPrefillingRowIndex(undefined);
    setPrefillingFieldValueMap(undefined);
    setNewRecords(undefined);
  };

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
    if (recordId) {
      const recordIndex = Number(
        Object.keys(recordMap).find((key) => recordMap[key]?.id === recordId)
      );

      recordIndex >= 0 &&
        gridRef.current?.setSelection(
          new CombinedSelection(SelectionRegionType.Cells, [
            [0, recordIndex],
            [0, recordIndex],
          ])
        );
    }
  }, [router.query.recordId, recordMap]);

  const getCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [colIndex, rowIndex] = cell;
      const record = recordMap[rowIndex];
      if (record !== undefined) {
        const fieldId = columns[colIndex]?.id;
        if (!fieldId) return { type: CellType.Loading };
        return cellValue2GridDisplay(record, colIndex, false, (tableId, recordId) =>
          setExpandRecord({ tableId, recordId })
        );
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

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const onContextMenu = (selection: CombinedSelection, position: IPosition) => {
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
      const isMultipleSelected =
        (isRowSelection && ranges.length > 1) || Math.abs(rowEnd - rowStart) > 0;

      if (isMultipleSelected) {
        openRecordMenu({
          position,
          isMultipleSelected,
          deleteRecords: async () => {
            deleteRecords(selection);
            gridRef.current?.setSelection(emptySelection);
          },
        });
      } else {
        const record = recordMap[rowStart];
        const neighborRecords: Array<Record | null> = [];
        neighborRecords[0] = rowStart === 0 ? null : recordMap[rowStart - 1];
        neighborRecords[1] = rowStart >= realRowCount - 1 ? null : recordMap[rowStart + 1];

        openRecordMenu({
          position,
          record,
          neighborRecords,
          insertRecord: (anchorId, position, num: number) => {
            if (!tableId || !view?.id || !record) return;
            const targetIndex = position === 'before' ? rowStart - 1 : rowStart;
            const fieldValueMap =
              group?.reduce(
                (prev, { fieldId }) => {
                  prev[fieldId] = record.getCellValue(fieldId);
                  return prev;
                },
                {} as { [key: string]: unknown }
              ) ?? {};
            generateRecord(fieldValueMap, Math.max(targetIndex, 0), { anchorId, position }, num);
          },
          duplicateRecord: async () => {
            if (!record || !activeViewId) return;
            await Record.duplicateRecord(tableId, record.id, {
              viewId: activeViewId,
              anchorId: record.id,
              position: 'after',
            });
          },
          deleteRecords: async () => {
            deleteRecords(selection);
            gridRef.current?.setSelection(emptySelection);
          },
          isMultipleSelected: false,
        });
      }
    }

    if (isColumnSelection) {
      const [start, end] = ranges[0];
      const selectColumns = extract(start, end, columns);
      const indexedColumns = keyBy(selectColumns, 'id');
      const selectFields = fields.filter((field) => indexedColumns[field.id]);
      const onSelectionClear = () => gridRef.current?.setSelection(emptySelection);
      openHeaderMenu({ position, fields: selectFields, onSelectionClear });
    }
  };

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
      if (!columns[colIndex]) return;
      const fieldId = columns[colIndex].id;
      const selectedFields = fields.find((field) => field.id === fieldId);
      if (!selectedFields || !fieldEditable(selectedFields)) {
        return;
      }
      gridRef.current?.setSelection(emptySelection);
      openSetting({ fieldId, operator: FieldOperator.Edit });
    },
    [columns, fields, fieldEditable, openSetting]
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

  const generateRecord = (
    fieldValueMap: { [fieldId: string]: unknown },
    targetIndex?: number,
    rowOrder?: IUpdateOrderRo,
    num?: number
  ) => {
    const index = targetIndex ?? Math.max(realRowCount - 1, 0);
    if (num === 0) {
      return;
    }
    if (num === 1 || num === undefined) {
      setPrefillingFieldValueMap(fieldValueMap);
      setPrefillingRowOrder(rowOrder);
      setPrefillingRowIndex(index);
      setSelection(emptySelection);
      gridRef.current?.setSelection(emptySelection);
      setTimeout(() => {
        prefillingGridRef.current?.setSelection(
          new CombinedSelection(SelectionRegionType.Cells, [
            [0, 0],
            [0, 0],
          ])
        );
      });
    } else {
      // insert empty records
      const emptyRecords = Array.from({ length: num }).fill({
        fields: {},
      }) as ICreateRecordsRo['records'];
      mutateCreateRecord(emptyRecords);
    }
  };

  const onRowAppend = (targetIndex?: number) => {
    if (group?.length && targetIndex != null) {
      const record = recordMap[targetIndex];

      if (record == null) return generateRecord({}, targetIndex);

      const fieldValueMap = group.reduce(
        (prev, { fieldId }) => {
          prev[fieldId] = record.getCellValue(fieldId);
          return prev;
        },
        {} as { [key: string]: unknown }
      );
      return generateRecord(fieldValueMap, targetIndex);
    }
    return generateRecord({}, targetIndex);
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

  const onCopy = (selection: CombinedSelection, e: React.ClipboardEvent) => {
    if (isSelectionLoaded({ selection, recordMap, rowCount: realRowCount })) {
      // sync copy
      syncCopy(e, { selection, recordMap });
      return;
    }
    copy(selection);
  };

  const onCopyForSingleRow = async (
    e: React.ClipboardEvent,
    selection: CombinedSelection,
    fieldValueMap?: { [fieldId: string]: unknown }
  ) => {
    const { type } = selection;

    if (type !== SelectionRegionType.Cells || fieldValueMap == null) return;

    const getCopyData = () => {
      const [start, end] = selection.serialize();
      const selectedFields = fields.slice(start[0], end[0] + 1);
      const filteredPropsFields = selectedFields
        .map((f) => {
          const validateField = fieldVoSchema.safeParse(f);
          return validateField.success ? validateField.data : undefined;
        })
        .filter(Boolean) as IFieldVo[];
      const content = [
        selectedFields.map((field) => field.cellValue2String(fieldValueMap[field.id] as never)),
      ];
      return { content: stringifyClipboardText(content), header: filteredPropsFields };
    };

    syncCopy(e, { getCopyData });
  };

  const onPaste = (selection: CombinedSelection, e: React.ClipboardEvent) => {
    if (!permission['record|update']) {
      return toast({ title: 'Unable to paste' });
    }
    paste(e, selection, recordMap);
  };

  const onPasteForPrefilling = (selection: CombinedSelection, e: React.ClipboardEvent) => {
    if (!permission['record|update'] || localRecord == null) {
      return toast({ title: 'Unable to paste' });
    }
    paste(e, selection, { 0: localRecord }, (records) => {
      if (records.length > 1) {
        confirmNewRecordsRef.current?.setOpen(true, records.length);
        setNewRecords(records);
        return;
      }
      setPrefillingFieldValueMap({ ...prefillingFieldValueMap, ...records[0].fields });
    });
  };

  const onPasteForPresort = (selection: CombinedSelection, e: React.ClipboardEvent) => {
    if (!presortRecord) return;
    if (!permission['record|update']) {
      return toast({ title: 'Unable to paste' });
    }
    paste(e, selection, { 0: presortRecord }, (records) => {
      Record.updateRecord(tableId, presortRecord.id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: { ...presortRecord.fields, ...records[0].fields },
        },
      });
    });
  };

  const collaborators = useCollaborate(selection, getCellContent);

  const groupedCollaborators = useMemo(() => {
    return groupBy(collaborators, 'activeCellId');
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

    if (type === RegionType.ColumnPrimaryIcon) {
      openTooltip({
        id: componentId,
        text: t('sdk:hidden.primaryKey'),
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
      const hoverCollaborators = groupedCollaborators?.[cellInfo.id]?.sort(
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

  const onDragStart = useCallback(
    (type: DragRegionType, dragIndexs: number[]) => {
      if (type === DragRegionType.Rows) {
        const recordIds = dragIndexs.map((index) => recordMap[index]?.id).filter(Boolean);
        setDraggingRecordIds(recordIds);
      }
    },
    [recordMap, setDraggingRecordIds]
  );

  const getAuthorizedFunction = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T extends (...args: any[]) => any>(
      fn: T,
      permissionAction: IUseTablePermissionAction
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
      top: Math.max(
        gridRef.current.getRowOffset(prefillingRowIndex) + defaultTop,
        GIRD_ROW_HEIGHT_DEFINITIONS[RowHeightLevel.Short]
      ),
      height,
    };
  }, [rowHeight, prefillingRowIndex]);

  const presortRowStyle = useMemo(() => {
    const defaultTop = rowHeight / 2;
    const height = rowHeight + 5;
    const rowIndex = presortRecordData?.rowIndex;

    if (gridRef.current == null || rowIndex == null) {
      return { top: defaultTop, height };
    }

    return {
      top: Math.max(
        gridRef.current.getRowOffset(rowIndex) + defaultTop,
        GIRD_ROW_HEIGHT_DEFINITIONS[RowHeightLevel.Short]
      ),
      height,
    };
  }, [rowHeight, presortRecordData]);

  useEffect(() => {
    if (!inPrefilling) return;
    const scrollState = gridRef.current?.getScrollState();
    if (scrollState == null) return;
    prefillingGridRef.current?.scrollTo(scrollState.scrollLeft, undefined);
  }, [inPrefilling]);

  useClickAway(containerRef, () => {
    gridRef.current?.resetState();
  });

  useScrollFrameRate(gridRef.current?.scrollBy);

  useHotkeys(
    ['mod+f', 'mod+k'],
    () => {
      gridRef.current?.setSelection(emptySelection);
    },
    {
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useEffect(() => {
    setGridRef?.(gridRef);
  }, [setGridRef]);

  return (
    <div ref={containerRef} className="relative size-full">
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
        commentCountMap={commentCountMap}
        customIcons={customIcons}
        rowControls={rowControls}
        collapsedGroupIds={collapsedGroupIds}
        groupCollection={groupCollection}
        groupPoints={groupPoints as unknown as IGroupPoint[]}
        collaborators={collaborators}
        searchCursor={searchCursor}
        searchHitIndex={searchHitIndex}
        getCellContent={getCellContent}
        onDelete={getAuthorizedFunction(onDelete, 'record|update')}
        onDragStart={onDragStart}
        onRowOrdered={onRowOrdered}
        onRowExpand={onRowExpandInner}
        onRowAppend={
          isTouchDevice ? undefined : getAuthorizedFunction(onRowAppend, 'record|create')
        }
        onCellEdited={getAuthorizedFunction(onCellEdited, 'record|update')}
        onColumnAppend={getAuthorizedFunction(onColumnAppend, 'field|create')}
        onColumnFreeze={getAuthorizedFunction(onColumnFreeze, 'view|update')}
        onColumnResize={getAuthorizedFunction(onColumnResize, 'view|update')}
        onColumnOrdered={getAuthorizedFunction(onColumnOrdered, 'view|update')}
        onContextMenu={onContextMenu}
        onColumnHeaderClick={onColumnHeaderClick}
        onColumnStatisticClick={getAuthorizedFunction(onColumnStatisticClick, 'view|update')}
        onVisibleRegionChanged={onVisibleRegionChanged}
        onSelectionChanged={onSelectionChanged}
        onColumnHeaderDblClick={onColumnHeaderDblClick}
        onColumnHeaderMenuClick={onColumnHeaderMenuClick}
        onCollapsedGroupChanged={onCollapsedGroupChanged}
        onScrollChanged={onGridScrollChanged}
        onUndo={undo}
        onRedo={redo}
        onCopy={onCopy}
        onPaste={onPaste}
        onItemClick={onItemClick}
        onItemHovered={onItemHovered}
      />
      {inPrefilling && (
        <PrefillingRowContainer
          style={prefillingRowStyle}
          isLoading={isCreatingRecord}
          onClickOutside={async () => {
            if (isCreatingRecord || newRecords?.length) return;
            await mutateCreateRecord([{ fields: prefillingFieldValueMap! }]);
          }}
          onCancel={() => {
            setPrefillingRowIndex(undefined);
            setPrefillingFieldValueMap(undefined);
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
            commentCountMap={commentCountMap}
            columnHeaderVisible={false}
            freezeColumnCount={frozenColumnCount}
            customIcons={customIcons}
            getCellContent={getPrefillingCellContent}
            onScrollChanged={onPrefillingGridScrollChanged}
            onCellEdited={onPrefillingCellEdited}
            onCopy={(selection, e) => onCopyForSingleRow(e, selection, prefillingFieldValueMap)}
            onPaste={onPasteForPrefilling}
          />
        </PrefillingRowContainer>
      )}
      {presortRecord && (
        <PresortRowContainer
          style={presortRowStyle}
          onClickOutside={async () => setPresortRecordData(undefined)}
        >
          <Grid
            ref={presortGridRef}
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
            commentCountMap={commentCountMap}
            freezeColumnCount={frozenColumnCount}
            customIcons={customIcons}
            getCellContent={getPresortCellContent}
            onScrollChanged={onPrefillingGridScrollChanged}
            onCellEdited={onPresortCellEdited}
            onCopy={(selection, e) => onCopyForSingleRow(e, selection, presortRecord.fields)}
            onPaste={onPasteForPresort}
          />
        </PresortRowContainer>
      )}
      <RowCounter rowCount={realRowCount} className="absolute bottom-3 left-0" />
      <DomBox id={componentId} />
      {!onRowExpand && <ExpandRecordContainer ref={expandRecordRef} recordServerData={ssrRecord} />}
      {expandRecord != null && (
        <ExpandRecorder
          tableId={expandRecord.tableId}
          viewId={activeViewId}
          recordId={expandRecord.recordId}
          recordIds={[expandRecord.recordId]}
          onClose={() => setExpandRecord(undefined)}
        />
      )}
      <ConfirmNewRecords
        ref={confirmNewRecordsRef}
        onCancel={() => {
          setPrefillingFieldValueMap({ ...prefillingFieldValueMap, ...newRecords?.[0].fields });
          setNewRecords(undefined);
        }}
        onConfirm={() => newRecords && mutateCreateRecord(newRecords)}
      />
    </div>
  );
};
