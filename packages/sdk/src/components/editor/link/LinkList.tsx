import type { ILinkCellValue } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { uniqueId } from 'lodash';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import type { ICell, ICellItem, IGridRef, IRectangle } from '../../grid';
import {
  CombinedSelection,
  Grid,
  CellType,
  RegionType,
  DraggableType,
  SelectableType,
  SelectionRegionType,
  emptySelection,
  RowControlType,
} from '../../grid';
import {
  GridTooltip,
  useGridIcons,
  useGridTheme,
  useGridColumns,
  useGridAsyncRecords,
  useGridTooltipStore,
} from '../../grid-enhancements';
import { LinkListType } from './interface';

interface ILinkListProps {
  type?: LinkListType;
  rowCount: number;
  hiddenFieldIds?: string[];
  readonly?: boolean;
  isMultiple?: boolean;
  recordQuery?: IGetRecordsRo;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  onChange?: (value?: ILinkCellValue[]) => void;
  onExpand?: (recordId: string) => void;
}

export interface ILinkListRef {
  onReset: () => void;
  onForceUpdate: () => void;
  setSelection: (selection: CombinedSelection) => void;
  scrollToItem: (position: [columnIndex: number, rowIndex: number]) => void;
}

const LinkListBase: ForwardRefRenderFunction<ILinkListRef, ILinkListProps> = (
  props,
  forwardRef
) => {
  const {
    readonly,
    type = LinkListType.Unselected,
    rowCount,
    cellValue,
    recordQuery,
    isMultiple,
    hiddenFieldIds,
    onChange,
    onExpand,
  } = props;

  useImperativeHandle(forwardRef, () => ({
    onReset,
    onForceUpdate,
    setSelection: (selection: CombinedSelection) => {
      gridRef.current?.setSelection(selection);
    },
    scrollToItem: (position: [columnIndex: number, rowIndex: number]) => {
      gridRef.current?.scrollToItem(position);
    },
  }));

  const theme = useGridTheme();
  const customIcons = useGridIcons();
  const { openTooltip, closeTooltip } = useGridTooltipStore();
  const { columns, cellValue2GridDisplay } = useGridColumns(false, hiddenFieldIds);

  const gridRef = useRef<IGridRef>(null);
  const rowCountRef = useRef<number>(rowCount);
  rowCountRef.current = rowCount;
  const isSelectedType = type === LinkListType.Selected;
  const isExpandEnable = Boolean(onExpand);
  const { t } = useTranslation();

  const { recordMap, onReset, onForceUpdate, onVisibleRegionChanged } = useGridAsyncRecords(
    undefined,
    recordQuery
  );

  const componentId = useMemo(() => uniqueId('link-editor-'), []);

  const rowControls = useMemo(() => {
    const controls = [];

    if (!readonly) {
      controls.push({
        type: RowControlType.Checkbox,
        icon: RowControlType.Checkbox,
      });
    }

    if (isExpandEnable) {
      controls.push({
        type: RowControlType.Expand,
        icon: RowControlType.Expand,
      });
    }
    return controls;
  }, [isExpandEnable, readonly]);

  useEffect(() => {
    if (!rowCount) return;
    gridRef.current?.setSelection(
      isSelectedType
        ? new CombinedSelection(SelectionRegionType.Rows, [[0, rowCount - 1]])
        : emptySelection
    );
  }, [rowCount, isSelectedType]);

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
        text: t('hidden.primaryKey'),
        position: bounds,
      });
    }
  };

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

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const onSelectionChanged = (selection: CombinedSelection) => {
    const { type } = selection;

    if (type === SelectionRegionType.None) {
      if (isSelectedType) {
        return onChange?.(undefined);
      }
      return cellValue
        ? onChange?.(Array.isArray(cellValue) ? cellValue : [cellValue])
        : onChange?.(cellValue);
    }

    if (type !== SelectionRegionType.Rows) return;

    let loadingInProgress = false;
    const rowIndexList = selection.flatten();

    const newValues = rowIndexList
      .map((rowIndex) => {
        const record = recordMap[rowIndex];
        if (record == null) {
          loadingInProgress = true;
        }
        const id = record?.id;
        const title = record?.name ?? t('common.untitled');
        return { id, title };
      })
      .filter((r) => r.id);

    if (loadingInProgress) return;

    if (isSelectedType) {
      return onChange?.(newValues);
    }

    const cv = cellValue == null ? null : Array.isArray(cellValue) ? cellValue : [cellValue];
    return onChange?.(isMultiple && cv ? [...cv, ...newValues] : newValues);
  };

  const onExpandInner = (rowIndex: number) => {
    const record = recordMap[rowIndex];
    if (record == null) return;
    onExpand?.(record.id);
  };

  return (
    <>
      <Grid
        ref={gridRef}
        style={{
          width: '100%',
          height: '100%',
        }}
        scrollBufferX={0}
        scrollBufferY={0}
        theme={theme}
        columns={columns}
        freezeColumnCount={0}
        rowCount={isSelectedType && !cellValue ? 0 : rowCount ?? 0}
        rowIndexVisible={false}
        customIcons={customIcons}
        rowControls={rowControls}
        draggable={DraggableType.None}
        selectable={readonly ? SelectableType.None : SelectableType.Row}
        isMultiSelectionEnable={isMultiple}
        onItemHovered={onItemHovered}
        getCellContent={getCellContent}
        onSelectionChanged={onSelectionChanged}
        onVisibleRegionChanged={onVisibleRegionChanged}
        onRowExpand={isExpandEnable ? onExpandInner : undefined}
      />
      <GridTooltip id={componentId} />
    </>
  );
};

export const LinkList = forwardRef(LinkListBase);
