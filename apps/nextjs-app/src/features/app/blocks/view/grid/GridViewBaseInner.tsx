import { useMutation } from '@tanstack/react-query';
import {
  FieldKeyType,
  FieldType,
  RowHeightLevel,
  contractColorForTheme,
  fieldVoSchema,
  stringifyClipboardText,
} from '@teable/core';
import type { IAttachmentCellValue, IFieldVo, IGridViewOptions } from '@teable/core';
import type { ICreateRecordsRo, IGroupPointsVo, IUpdateOrderRo } from '@teable/openapi';
import { createRecords, stopFillField, UploadType } from '@teable/openapi';
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
  IRange,
  Record,
  IButtonCell,
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
  DragRegionType,
  useGridFileEvent,
  extractDefaultFieldsFromFilters,
  TaskStatusCollectionContext,
  isNeedPersistEditing,
} from '@teable/sdk';
import { GRID_DEFAULT } from '@teable/sdk/components/grid/configs';
import { useScrollFrameRate } from '@teable/sdk/components/grid/hooks';
import {
  useBaseId,
  useFields,
  useIsTouchDevice,
  usePersonalView,
  useRowCount,
  useSession,
  useSSRRecord,
  useSSRRecords,
  useTableId,
  useTablePermission,
  useUndoRedo,
  useView,
  useViewId,
  useRecordOperations,
  useButtonClickStatus,
  useFieldOperations,
} from '@teable/sdk/hooks';
import { ConfirmDialog, useConfirm } from '@teable/ui-lib';
import { toast, toast as sonnerToast } from '@teable/ui-lib/shadcn/ui/sonner';
import { isEqual, keyBy, uniqueId, groupBy } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { usePrevious, useClickAway } from 'react-use';
import { computeFrozenColumnCount } from '@/features/app/blocks/view/grid/utils/computeFrozenFields';
import { ExpandRecordContainer } from '@/features/app/components/expand-record-container';
import type { IExpandRecordContainerRef } from '@/features/app/components/expand-record-container/types';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { uploadFiles } from '@/features/app/utils/uploadFile';
import { tableConfig } from '@/features/i18n/table.config';
import { FieldOperator } from '../../../components/field-setting';
import { useFieldSettingStore } from '../field/useFieldSettingStore';
import { useContextMenu } from '../hooks/useContextMenu';
import { AiGenerateButton, PrefillingRowContainer, PresortRowContainer } from './components';
import { ResetClickCountButton } from './components/ResetClickCountButton';
import { GIRD_FIELD_NAME_HEIGHT_DEFINITIONS, GIRD_ROW_HEIGHT_DEFINITIONS } from './const';
import { DomBox } from './DomBox';
import { useCollaborate, useSelectionOperation } from './hooks';
import { useIsSelectionLoaded } from './hooks/useIsSelectionLoaded';
import { useGridSearchStore } from './useGridSearchStore';
import { getEffectRows, generateSeriesForColumn, isEmptyValue } from './utils';
import { getSyncCopyData } from './utils/getSyncCopyData';

interface IGridViewBaseInnerProps {
  groupPointsServerData?: IGroupPointsVo;
  onRowExpand?: (recordId: string) => void;
}

const { scrollBuffer, columnAppendBtnWidth, columnStatisticHeight } = GRID_DEFAULT;
const MAX_PREFILLING_REGION_HEIGHT = 163;

export const GridViewBaseInner: React.FC<IGridViewBaseInnerProps> = (
  props: IGridViewBaseInnerProps
) => {
  const { groupPointsServerData, onRowExpand } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { updateRecord, duplicateRecord } = useRecordOperations();
  const { autoFillField } = useFieldOperations();
  const router = useRouter();
  const baseId = useBaseId();
  const tableId = useTableId() as string;
  const activeViewId = useViewId();
  const { user } = useSession();
  const view = useView(activeViewId) as GridView | undefined;
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const ssrRecord = useSSRRecord();
  const theme = useGridTheme();
  const fields = useFields();
  const usage = useBaseUsage();
  const allFields = useFields({ withHidden: true });
  const taskStatusCollection = useContext(TaskStatusCollectionContext);
  const buttonClickStatusHook = useButtonClickStatus(tableId);
  const { columns: originalColumns, cellValue2GridDisplay } = useGridColumns();
  const { columns, onColumnResize } = useGridColumnResize(originalColumns);
  const { columnStatistics } = useGridColumnStatistics(columns);
  const { onColumnOrdered } = useGridColumnOrder();
  const {
    selection,
    setSelection,
    openRecordMenu,
    openHeaderMenu,
    openStatisticMenu,
    openGroupHeaderMenu,
  } = useGridViewStore();
  const { openSetting } = useFieldSettingStore();
  const { openTooltip, closeTooltip } = useGridTooltipStore();
  const preTableId = usePrevious(tableId);
  const isTouchDevice = useIsTouchDevice();
  const { sort, group, filter, options } = view ?? {};
  const isAutoSort = sort && !sort?.manualSort;
  const { frozenFieldId, frozenColumnCount: frozenColumnCountOption } = (options ??
    {}) as IGridViewOptions;
  const frozenColumnCount = useMemo(() => {
    return computeFrozenColumnCount({
      isTouchDevice,
      frozenFieldId,
      frozenColumnCount: frozenColumnCountOption,
      visibleColumns: columns,
      allFields,
    });
  }, [isTouchDevice, frozenFieldId, columns, allFields, frozenColumnCountOption]);
  const { cells: taskStatusCells, fieldMap: taskStatusFieldMap } = taskStatusCollection ?? {};
  const rowHeight = GIRD_ROW_HEIGHT_DEFINITIONS[options?.rowHeight ?? RowHeightLevel.Short];
  const columnHeaderHeight =
    GIRD_FIELD_NAME_HEIGHT_DEFINITIONS[options?.fieldNameDisplayLines ?? 1];
  const permission = useTablePermission();
  const realRowCount = rowCount ?? ssrRecords?.length ?? 0;
  const fieldEditable = permission['field|update'];
  const { undo, redo } = useUndoRedo();
  const { setGridRef, searchCursor, setRecordMap } = useGridSearchStore();
  const [expandRecord, setExpandRecord] = useState<{ tableId: string; recordId: string }>();
  const [autoFillFieldId, setAutoFillFieldId] = useState<string | undefined>();

  const { fieldAIEnable = false } = usage?.limit ?? {};

  const aiGenerateButtonRef = useRef<{
    onScrollHandler: () => void;
  }>(null);
  const resetClickCountButtonRef = useRef<{
    onScrollHandler: () => void;
  }>(null);

  const gridRef = useRef<IGridRef>(null);
  const presortGridRef = useRef<IGridRef>(null);
  const prefillingGridRef = useRef<IGridRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);

  const groupCollection = useGridGroupCollection();

  const { personalViewCommonQuery } = usePersonalView();
  const { viewQuery, collapsedGroupIds, onCollapsedGroupChanged } = useGridCollapsedGroup(
    generateLocalId(tableId, activeViewId),
    personalViewCommonQuery
  );

  const {
    onVisibleRegionChanged,
    onReset,
    recordMap,
    groupPoints,
    recordsQuery,
    searchHitIndex,
    allGroupHeaderRefs,
  } = useGridAsyncRecords(ssrRecords, undefined, viewQuery, groupPointsServerData);

  const isSelectionLoaded = useIsSelectionLoaded();

  const commentCountMap = useCommentCountMap(recordsQuery);

  const { onRowOrdered, setDraggingRecordIds } = useGridRowOrder(recordMap);

  const { copy, paste, clear, deleteRecords, syncCopy, fill } = useSelectionOperation({
    collapsedGroupIds: viewQuery?.collapsedGroupIds
      ? Array.from(viewQuery?.collapsedGroupIds)
      : undefined,
  });

  const { copyRecordUrl, viewRecordHistory, addRecordComment } = useContextMenu();

  const {
    activeCell,
    presortRecord,
    presortRecordData,
    onSelectionChanged,
    onPresortCellEdited,
    getPresortCellContent,
    setPresortRecordData,
  } = useGridSelection({ recordMap, columns, viewQuery, gridRef });

  const {
    localRecords,
    prefillingRows,
    prefillingRowIndex,
    prefillingRowOrder,
    setPrefillingRows,
    setPrefillingRowIndex,
    setPrefillingRowOrder,
    onPrefillingCellEdited,
    getPrefillingCellContent,
  } = useGridPrefillingRow(columns);

  const inPresorting = presortRecord != null;
  const inPrefilling = prefillingRowIndex != null;

  const buildPrefillingInitialFields = useCallback(
    async (baseValueMap: { [fieldId: string]: unknown } = {}) => {
      const filterValueMap = await extractDefaultFieldsFromFilters({
        filter,
        fieldMap: keyBy(allFields, 'id'),
        currentUserId: user.id,
      });
      let groupValueMap: { [fieldId: string]: unknown } = {};
      if (group?.length && prefillingRowIndex != null) {
        const refRecord = recordMap[prefillingRowIndex];
        if (refRecord) {
          groupValueMap = group.reduce(
            (prev, { fieldId }) => {
              prev[fieldId] = refRecord.getCellValue(fieldId);
              return prev;
            },
            {} as { [fieldId: string]: unknown }
          );
        }
      }
      return { ...baseValueMap, ...groupValueMap, ...filterValueMap };
    },
    [allFields, group, prefillingRowIndex, recordMap, user.id, filter]
  );

  const onValidation = useCallback(
    (cell: ICellItem) => {
      if (!permission['view|update']) return false;

      const [columnIndex] = cell;
      const field = fields[columnIndex];

      if (!field) return false;

      const { type, isComputed } = field;
      return type === FieldType.Attachment && !isComputed;
    },
    [fields, permission]
  );

  const onCellDrop = useCallback(
    async (cell: ICellItem, files: FileList) => {
      const attachments = await uploadFiles(files, UploadType.Table, baseId);

      const [columnIndex, rowIndex] = cell;
      const record = recordMap[rowIndex];
      const field = fields[columnIndex];
      const oldCellValue = (record.getCellValue(field.id) as IAttachmentCellValue) || [];
      await record.updateCell(field.id, [...oldCellValue, ...attachments]);
    },
    [baseId, fields, recordMap]
  );

  const onPrefillingCellDrop = useCallback(
    async (cell: ICellItem, files: FileList) => {
      const attachments = await uploadFiles(files, UploadType.Table, baseId);
      const [columnIndex, rowIndex] = cell;
      const field = fields[columnIndex];
      setPrefillingRows((prev) => {
        const next = [...prev];
        const row = next[rowIndex];
        if (!row) return prev;
        const oldCellValue = (row.fields[field.id] as IAttachmentCellValue) || [];
        next[rowIndex] = {
          fields: { ...row.fields, [field.id]: [...oldCellValue, ...attachments] },
        };
        return next;
      });
    },
    [baseId, fields, setPrefillingRows]
  );

  useGridFileEvent({
    gridRef: inPrefilling ? prefillingGridRef : gridRef,
    onValidation,
    onCellDrop: inPrefilling ? onPrefillingCellDrop : onCellDrop,
  });

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
    setPrefillingRows([]);
  };

  useEffect(() => {
    setRecordMap(recordMap);
  }, [recordMap, setRecordMap]);

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
        return cellValue2GridDisplay(
          record,
          colIndex,
          false,
          (tableId, recordId) => setExpandRecord({ tableId, recordId }),
          buttonClickStatusHook
        );
      }
      return { type: CellType.Loading };
    },
    [recordMap, columns, cellValue2GridDisplay, buttonClickStatusHook]
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
      record.updateCell(fieldId, newCellValue, { t, prefix: 'sdk' });
      return record;
    },
    [recordMap, columns, t]
  );

  const { confirm } = useConfirm();

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
            const deleteRows = getEffectRows(selection);

            if (deleteRows >= 10) {
              const confirmed = await confirm({
                title: t('table:table.actionTips.deleteRecordConfirmTitle'),
                description: t('table:table.actionTips.deleteRecordConfirmDescription', {
                  recordCount: deleteRows,
                }),
                confirmText: t('table:table.actionTips.deleteRecord'),
                cancelText: t('common:actions.cancel'),
                confirmButtonVariant: 'destructive',
              });
              if (!confirmed) return;
            }

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
            await duplicateRecord({
              tableId,
              recordId: record.id,
              order: {
                viewId: activeViewId,
                anchorId: record.id,
                position: 'after',
              },
            });
          },
          deleteRecords: async () => {
            deleteRecords(selection);
            gridRef.current?.setSelection(emptySelection);
          },
          copyRecordUrl: async () => {
            await copyRecordUrl(record?.id);
          },
          viewRecordHistory: async () => {
            await viewRecordHistory(record?.id);
          },
          addRecordComment: async () => {
            await addRecordComment(record?.id);
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
      const onAutoFill = (fieldId: string) => setAutoFillFieldId(fieldId);
      const onSelectionClear = () => gridRef.current?.setSelection(emptySelection);
      openHeaderMenu({
        position,
        fields: selectFields,
        aiEnable: fieldAIEnable,
        onSelectionClear,
        onAutoFill,
      });
    }
  };

  const onGroupHeaderContextMenu = (groupId: string, position: IPosition) => {
    openGroupHeaderMenu({
      groupId,
      position,
      allGroupHeaderRefs,
    });
  };

  const onColumnHeaderMenuClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      const fieldId = columns[colIndex].id;
      const { x, height } = bounds;
      const selectedFields = fields.filter((field) => field.id === fieldId);
      const onAutoFill = (fieldId: string) => setAutoFillFieldId(fieldId);
      openHeaderMenu({
        fields: selectedFields,
        position: { x, y: height },
        aiEnable: fieldAIEnable,
        onAutoFill,
      });
    },
    [columns, fields, fieldAIEnable, openHeaderMenu]
  );

  const onColumnHeaderDblClick = useCallback(
    (colIndex: number) => {
      if (!columns[colIndex]) return;
      const fieldId = columns[colIndex].id;
      if (!fieldEditable) {
        return;
      }
      gridRef.current?.setSelection(emptySelection);
      openSetting({ fieldId, operator: FieldOperator.Edit });
    },
    [columns, fieldEditable, openSetting]
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
      const anchorId = columns[Math.max(0, count - 1)]?.id;
      if (!view || !anchorId) return;
      view.updateOption({ frozenFieldId: anchorId });
    },
    [view, columns]
  );

  const generateRecord = async (
    fieldValueMap: { [fieldId: string]: unknown },
    targetIndex?: number,
    rowOrder?: IUpdateOrderRo,
    num?: number
  ) => {
    const index = targetIndex ?? Math.max(realRowCount - 1, 0);

    if (num === 0) return;

    setPrefillingRowOrder(rowOrder);

    const count = num ?? 1;
    const initialFields = await buildPrefillingInitialFields(fieldValueMap);
    setPrefillingRows(Array.from({ length: count }).map(() => ({ fields: initialFields })));
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
    if (!permission['record|copy']) {
      sonnerToast.warning(t('table:table.actionTips.copyError.noPermission'));
      return;
    }
    if (isSelectionLoaded({ selection, recordMap, rowCount: realRowCount })) {
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

  const onCopyForPrefilling = (selection: CombinedSelection, e: React.ClipboardEvent) => {
    if (!localRecords.length) return;
    const recordMapForCopy: { [key: number]: Record } = {};
    for (let i = 0; i < localRecords.length; i++) {
      recordMapForCopy[i] = localRecords[i];
    }
    syncCopy(e, { selection, recordMap: recordMapForCopy });
  };

  const onPaste = async (selection: CombinedSelection, e: React.ClipboardEvent) => {
    if (!permission['record|update']) {
      return toast.warning(t('table:table.actionTips.pasteError.noPermission'));
    }
    await paste(e, selection, recordMap);
  };

  const onPasteForPrefilling = (selection: CombinedSelection, e: React.ClipboardEvent) => {
    if (!localRecords.length) return;
    const [start, end] = selection.serialize();
    const startRow = Math.min(start[1], end[1]);
    const endRow = Math.max(start[1], end[1]);
    const recordMapForPaste: { [key: number]: Record } = {};
    for (let r = startRow; r <= endRow; r++) {
      recordMapForPaste[r - startRow] = localRecords[r];
    }
    paste(e, selection, recordMapForPaste, (records) => {
      setPrefillingRows((prev) => {
        if (records.length <= 0) return prev;
        const baseIndex = startRow;
        const next = [...prev];
        for (let i = 0; i < records.length; i++) {
          const idx = baseIndex + i;
          const rec = records[i];
          if (next[idx]) {
            next[idx] = { fields: { ...(next[idx].fields ?? {}), ...(rec.fields ?? {}) } };
          } else {
            next[idx] = { fields: { ...(rec.fields ?? {}) } };
          }
        }
        return next.filter(Boolean);
      });
    });
  };

  const onPasteForPresort = (selection: CombinedSelection, e: React.ClipboardEvent) => {
    if (!presortRecord) return;
    if (!permission['record|update']) {
      return toast.warning(t('table:table.actionTips.pasteError.noPermission'));
    }
    paste(e, selection, { 0: presortRecord }, (records) => {
      updateRecord({
        tableId,
        recordId: presortRecord.id,
        recordRo: {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: { ...presortRecord.fields, ...records[0].fields },
          },
        },
      });
    });
  };

  const onDeleteForPrefilling = (selection: CombinedSelection) => {
    const [start, end] = selection.serialize();
    const startCol = Math.min(start[0], end[0]);
    const endCol = Math.max(start[0], end[0]);
    const startRow = Math.min(start[1], end[1]);
    const endRow = Math.max(start[1], end[1]);
    setPrefillingRows((prev) => {
      const next = [...prev];
      for (let row = startRow; row <= endRow; row++) {
        const rowData = next[row];
        if (!rowData) continue;
        const updated: { [fieldId: string]: unknown } = { ...rowData.fields };
        for (let col = startCol; col <= endCol; col++) {
          const fieldId = columns[col]?.id;
          if (!fieldId) continue;
          updated[fieldId] = null;
        }
        next[row] = { fields: updated };
      }
      return next;
    });
  };

  const onDeleteForPresort = (selection: CombinedSelection) => {
    if (!presortRecord) return;

    const [start, end] = selection.serialize();
    const startCol = Math.min(start[0], end[0]);
    const endCol = Math.max(start[0], end[0]);

    const fieldsToNull: { [fieldId: string]: unknown } = {};
    for (let col = startCol; col <= endCol; col++) {
      const fieldId = columns[col]?.id;
      if (!fieldId) continue;
      fieldsToNull[fieldId] = null;
    }

    updateRecord({
      tableId,
      recordId: presortRecord.id,
      recordRo: {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: { ...presortRecord.fields, ...fieldsToNull },
        },
      },
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

  const onFillSelection = (selectionRanges: [IRange, IRange], targetEndRealRowIndex: number) => {
    const [start, end] = selectionRanges;
    const startCol = Math.min(start[0], end[0]);
    const endCol = Math.max(start[0], end[0]);
    const topRow = Math.min(start[1], end[1]);
    const bottomRow = Math.max(start[1], end[1]);
    if (!tableId) return;
    const isDownward = targetEndRealRowIndex > bottomRow;
    const isUpward = targetEndRealRowIndex < topRow;
    if (!isDownward && !isUpward) return;

    const selectionForCopy = new CombinedSelection(SelectionRegionType.Cells, [start, end]);
    const { headers, rawContent } = getSyncCopyData({
      recordMap,
      fields,
      selection: selectionForCopy,
    });

    const allEmpty = rawContent.every((row) => row.every((v) => isEmptyValue(v)));

    if (allEmpty) return;

    const selectedFields = fields.slice(startCol, endCol + 1);
    const content: unknown[][] = [];

    if (isDownward) {
      const rowsToFill = targetEndRealRowIndex - bottomRow;
      const direction = 'down' as const;
      const columnsCount = endCol - startCol + 1;
      const colSeries: unknown[][] = [];
      for (let c = 0; c < columnsCount; c++) {
        const baseColValues = rawContent.map((r) => (r ?? [])[c]);
        const series = generateSeriesForColumn(
          baseColValues,
          selectedFields[c].type,
          rowsToFill,
          direction
        );
        colSeries.push(series);
      }
      for (let r = 0; r < rowsToFill; r++) {
        content.push(colSeries.map((s) => s[r]));
      }
      fill({
        content,
        header: headers,
        ranges: [
          [startCol, bottomRow + 1],
          [endCol, targetEndRealRowIndex],
        ],
      });
    } else if (isUpward) {
      const rowsToFill = topRow - targetEndRealRowIndex;
      const direction = 'up' as const;
      const columnsCount = endCol - startCol + 1;
      const colSeries: unknown[][] = [];
      for (let c = 0; c < columnsCount; c++) {
        const baseColValues = rawContent.map((r) => (r ?? [])[c]);
        const series = generateSeriesForColumn(
          baseColValues,
          selectedFields[c].type,
          rowsToFill,
          direction
        );
        colSeries.push(series);
      }
      for (let r = 0; r < rowsToFill; r++) {
        const idx = rowsToFill - 1 - r;
        content.push(colSeries.map((s) => s[idx]));
      }
      fill({
        content,
        header: headers,
        ranges: [
          [startCol, targetEndRealRowIndex],
          [endCol, topRow - 1],
        ],
      });
    }
  };

  const componentId = useMemo(() => uniqueId('grid-view-'), []);

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

    if (type === RegionType.CellValue) {
      onCellValueHovered(bounds, cellItem);
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
    aiGenerateButtonRef.current?.onScrollHandler();
    resetClickCountButtonRef.current?.onScrollHandler();
  }, []);

  const onPrefillingGridScrollChanged = useCallback((sl?: number, _st?: number) => {
    gridRef.current?.scrollTo(sl, undefined);
  }, []);

  const prefillingRowStyle = useMemo(() => {
    const defaultTop = rowHeight;
    const height = rowHeight * Math.max(prefillingRows.length, 1) + 3;

    if (gridRef.current == null || prefillingRowIndex == null) {
      return { top: 0, height };
    }

    const minTop = GIRD_ROW_HEIGHT_DEFINITIONS[RowHeightLevel.Short];
    const baseTop = gridRef.current.getRowOffset(prefillingRowIndex) + defaultTop;
    const containerHeight = containerRef.current?.clientHeight ?? 0;
    const effectiveHeight = Math.min(height, MAX_PREFILLING_REGION_HEIGHT);
    const bottomSafe = GIRD_ROW_HEIGHT_DEFINITIONS[RowHeightLevel.Short] + columnStatisticHeight;
    const maxTop =
      containerHeight > 0
        ? Math.max(minTop, containerHeight - effectiveHeight - bottomSafe)
        : Infinity;

    return {
      top: Math.min(Math.max(baseTop, minTop), maxTop),
      height,
    };
  }, [rowHeight, prefillingRowIndex, prefillingRows.length]);

  const presortRowStyle = useMemo(() => {
    const height = rowHeight + 5;
    const rowIndex = presortRecordData?.rowIndex;

    if (gridRef.current == null || rowIndex == null) {
      return { top: 0, height };
    }

    return {
      top: Math.max(
        gridRef.current.getRowOffset(rowIndex),
        GIRD_ROW_HEIGHT_DEFINITIONS[RowHeightLevel.Short]
      ),
      height,
    };
  }, [rowHeight, presortRecordData]);

  useEffect(() => {
    if (!inPrefilling && !inPresorting) return;
    const scrollState = gridRef.current?.getScrollState();
    if (scrollState == null) return;
    presortGridRef.current?.scrollTo(scrollState.scrollLeft, undefined);
    prefillingGridRef.current?.scrollTo(scrollState.scrollLeft, undefined);
  }, [inPrefilling, inPresorting]);

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

  useEffect(() => setGridRef?.(gridRef), [setGridRef]);

  useEffect(() => {
    const recordId2IndexMap: { [id: string]: number } = {};
    Object.entries(recordMap).forEach(([index, record]) => {
      if (record == null) return;
      recordId2IndexMap[record.id] = index as unknown as number;
    });
    const fieldId2IndexMap: { [id: string]: number } = {};
    fields.forEach(({ id }, index) => (fieldId2IndexMap[id] = index));
    const loadingCells = taskStatusCells
      ?.filter(
        ({ recordId, fieldId }) =>
          recordId2IndexMap[recordId] != null && fieldId2IndexMap[fieldId] != null
      )
      .map(({ recordId, fieldId }) => [fieldId2IndexMap[fieldId], recordId2IndexMap[recordId]]);
    gridRef.current?.setCellLoading((loadingCells ?? []) as ICellItem[]);
  }, [fields, recordMap, taskStatusCells]);

  useEffect(() => {
    const fieldId2IndexMap: { [id: string]: number } = {};
    fields.forEach(({ id }, index) => (fieldId2IndexMap[id] = index));
    const loadingColumnIndexs = Object.keys(taskStatusFieldMap ?? {}).map((fieldId) => {
      const index = fieldId2IndexMap[fieldId];
      const { completedCount = 0, totalCount } = taskStatusFieldMap?.[fieldId] ?? {};
      return {
        index,
        progress: totalCount ? completedCount / totalCount : 0,
        onCancel: () => {
          stopFillField(tableId, fieldId);
        },
      };
    });
    gridRef.current?.setColumnLoadings(loadingColumnIndexs);
  }, [tableId, fields, taskStatusFieldMap]);

  const onPresortContainerInit = () => {
    if (!activeCell) return;

    const { columnIndex, fieldId } = activeCell;

    if (gridRef.current?.isEditing() && isNeedPersistEditing(allFields, fieldId)) return;
    if (columnIndex == null) return;

    const range = [columnIndex, 0] as IRange;
    setTimeout(() => {
      gridRef.current?.setSelection(emptySelection);
      presortGridRef.current?.setSelection(
        new CombinedSelection(SelectionRegionType.Cells, [range, range])
      );
    }, 100);
  };

  const onCellDblClick = (cell: ICellItem) => {
    const [columnIndex, rowIndex] = cell;
    const record = recordMap[rowIndex];
    if (record == null) return;
    const field = columns[columnIndex];
    if (field == null) return;
    if (record.isHidden(field.id)) {
      return sonnerToast.warning(t('table:permission.cell.deniedRead'));
    }
    if (record.isLocked(field.id)) {
      return sonnerToast.warning(t('table:permission.cell.deniedUpdate'));
    }
  };

  return (
    <div ref={containerRef} className="relative size-full">
      <Grid
        ref={gridRef}
        theme={theme}
        style={{ pointerEvents: inPrefilling || inPresorting ? 'none' : 'auto' }}
        draggable={draggable}
        isTouchDevice={isTouchDevice}
        rowCount={realRowCount}
        rowHeight={rowHeight}
        columnHeaderHeight={columnHeaderHeight}
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
        onFillSelection={getAuthorizedFunction(onFillSelection, 'record|update')}
        onCellDblClick={onCellDblClick}
        onColumnAppend={getAuthorizedFunction(onColumnAppend, 'field|create')}
        onColumnFreeze={getAuthorizedFunction(onColumnFreeze, 'view|update')}
        onColumnResize={getAuthorizedFunction(onColumnResize, 'view|update')}
        onColumnOrdered={getAuthorizedFunction(onColumnOrdered, 'view|update')}
        onContextMenu={onContextMenu}
        onGroupHeaderContextMenu={onGroupHeaderContextMenu}
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
      {fieldAIEnable && (
        <AiGenerateButton
          ref={aiGenerateButtonRef}
          gridRef={gridRef}
          activeCell={activeCell}
          recordMap={recordMap}
        />
      )}
      {activeCell && (
        <ResetClickCountButton
          ref={resetClickCountButtonRef}
          gridRef={gridRef}
          activeCell={activeCell}
          recordMap={recordMap}
        />
      )}
      {inPrefilling && (
        <PrefillingRowContainer
          style={{
            ...prefillingRowStyle,
            maxHeight: MAX_PREFILLING_REGION_HEIGHT,
          }}
          isLoading={isCreatingRecord}
          onClickOutside={async () => {
            if (isCreatingRecord || !prefillingRows.length) return;
            const requiredFieldIds = allFields
              .filter((f) => !f.isComputed && f.notNull)
              .map((f) => f.id);
            if (!requiredFieldIds.length) return;
            const missingFieldIdSet = new Set<string>();
            for (const row of prefillingRows) {
              for (const fid of requiredFieldIds) {
                if (isEmptyValue((row.fields ?? {})[fid])) {
                  missingFieldIdSet.add(fid);
                }
              }
            }
            if (!missingFieldIdSet.size) return;
            const missingNames = allFields
              .filter((f) => missingFieldIdSet.has(f.id))
              .map((f) => f.name);
            return toast.warning(
              t('table:table.actionTips.requiredFieldsMissing', {
                fieldNames: missingNames.join(', '),
              })
            );
            await mutateCreateRecord(prefillingRows.map((r) => ({ fields: r.fields })));
          }}
          onCancel={() => {
            setPrefillingRowIndex(undefined);
            setPrefillingRows([]);
          }}
          onAddRow={async () => {
            const initialFields = await buildPrefillingInitialFields();
            setPrefillingRows((prev) => [...prev, { fields: initialFields }]);
            const prefillingRowCount = prefillingRows.length;
            prefillingGridRef.current?.scrollToItem([0, prefillingRowCount]);
            setTimeout(() => {
              prefillingGridRef.current?.setSelection(
                new CombinedSelection(SelectionRegionType.Cells, [
                  [0, prefillingRowCount],
                  [0, prefillingRowCount],
                ])
              );
            });
          }}
        >
          <Grid
            ref={prefillingGridRef}
            theme={theme}
            scrollBufferX={
              permission['field|create'] ? scrollBuffer + columnAppendBtnWidth : scrollBuffer
            }
            scrollBufferY={0}
            scrollBarXVisible={false}
            rowCount={prefillingRows.length || 1}
            rowHeight={rowHeight}
            rowControls={rowControls}
            draggable={DraggableType.None}
            selectable={SelectableType.Cell}
            columns={columns}
            commentCountMap={commentCountMap}
            columnHeaderHeight={0}
            freezeColumnCount={frozenColumnCount}
            customIcons={customIcons}
            getCellContent={getPrefillingCellContent}
            onScrollChanged={onPrefillingGridScrollChanged}
            onCellEdited={onPrefillingCellEdited}
            onCopy={onCopyForPrefilling}
            onPaste={onPasteForPrefilling}
            onDelete={getAuthorizedFunction(onDeleteForPrefilling, 'record|update')}
          />
        </PrefillingRowContainer>
      )}
      {presortRecord && (
        <PresortRowContainer
          style={presortRowStyle}
          onInit={onPresortContainerInit}
          onClickOutside={async () => setPresortRecordData(undefined)}
        >
          <Grid
            ref={presortGridRef}
            theme={theme}
            scrollBufferX={
              permission['field|create'] ? scrollBuffer + columnAppendBtnWidth : scrollBuffer
            }
            scrollBufferY={0}
            scrollBarXVisible={false}
            scrollBarYVisible={false}
            rowCount={1}
            rowHeight={rowHeight}
            rowIndexVisible={false}
            rowControls={rowControls}
            draggable={DraggableType.None}
            selectable={SelectableType.Cell}
            columns={columns}
            columnHeaderHeight={0}
            commentCountMap={commentCountMap}
            freezeColumnCount={frozenColumnCount}
            customIcons={customIcons}
            getCellContent={getPresortCellContent}
            onScrollChanged={onPrefillingGridScrollChanged}
            onCellEdited={onPresortCellEdited}
            onCopy={(selection, e) => onCopyForSingleRow(e, selection, presortRecord.fields)}
            onPaste={onPasteForPresort}
            onDelete={getAuthorizedFunction(onDeleteForPresort, 'record|update')}
          />
        </PresortRowContainer>
      )}
      <RowCounter rowCount={realRowCount} className="absolute bottom-3 left-0" />
      <DomBox id={componentId} />
      {!onRowExpand && (
        <ExpandRecordContainer
          ref={expandRecordRef}
          recordServerData={ssrRecord}
          buttonClickStatusHook={buttonClickStatusHook}
        />
      )}
      {expandRecord != null && (
        <ExpandRecorder
          tableId={expandRecord.tableId}
          viewId={activeViewId}
          recordId={expandRecord.recordId}
          recordIds={[expandRecord.recordId]}
          onClose={() => setExpandRecord(undefined)}
          buttonClickStatusHook={buttonClickStatusHook}
        />
      )}
      {/* removed legacy ConfirmNewRecords flow */}
      <ConfirmDialog
        open={Boolean(autoFillFieldId)}
        onOpenChange={(val) => {
          if (!val) setAutoFillFieldId(undefined);
        }}
        closeable={false}
        title={t('table:field.aiConfig.autoFillFieldDialog.title')}
        description={t('table:field.aiConfig.autoFillFieldDialog.description')}
        onCancel={() => setAutoFillFieldId(undefined)}
        cancelText={t('common:actions.cancel')}
        confirmText={t('common:actions.update')}
        onConfirm={() => {
          if (!tableId || !view || !autoFillFieldId) return;
          const query = personalViewCommonQuery
            ? {
                filter: personalViewCommonQuery.filter,
                orderBy: personalViewCommonQuery.orderBy,
                groupBy: personalViewCommonQuery.groupBy,
                ignoreViewQuery: true,
              }
            : {
                viewId: view.id,
                groupBy: group,
              };

          autoFillField({ tableId, fieldId: autoFillFieldId, query });
          setAutoFillFieldId(undefined);
        }}
      />
    </div>
  );
};
