import type { IGetRecordsRo, ILinkCellValue, ILinkFieldOptions } from '@teable-group/core';
import { isMultiValueLink } from '@teable-group/core';
import { Plus } from '@teable-group/icons';
import { Button, Input, Tabs, TabsList, TabsTrigger } from '@teable-group/ui-lib';
import { uniqueId } from 'lodash';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ForwardRefRenderFunction } from 'react';
import { AnchorProvider } from '../../../context';
import { useTranslation } from '../../../context/app/i18n';
import { useBase, useTable } from '../../../hooks';
import { Table } from '../../../model';
import type { IGridRef } from '../../grid/Grid';
import { Grid } from '../../grid/Grid';
import type { ICell, ICellItem, IRectangle } from '../../grid/interface';
import {
  CellType,
  DraggableType,
  RegionType,
  SelectableType,
  SelectionRegionType,
} from '../../grid/interface';
import { emptySelection, CombinedSelection } from '../../grid/managers';
import {
  GridTooltip,
  useGridAsyncRecords,
  useGridColumns,
  useGridIcons,
  useGridTheme,
  useGridTooltipStore,
} from '../../grid-enhancements';

export interface ILinkEditorMainProps {
  fieldId: string;
  recordId?: string;
  options: ILinkFieldOptions;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  isEditing?: boolean;
  setEditing?: (isEditing: boolean) => void;
  onChange?: (value?: ILinkCellValue | ILinkCellValue[]) => void;
  onExpandRecord?: (recordId: string) => void;
}

export interface ILinkEditorMainRef {
  onReset: () => void;
}

enum ViewType {
  Selected = 'selected',
  Unselected = 'unselected',
}

const LinkEditorInnerBase: ForwardRefRenderFunction<ILinkEditorMainRef, ILinkEditorMainProps> = (
  props,
  forwardRef
) => {
  const { recordId, fieldId, options, cellValue, isEditing, setEditing, onChange, onExpandRecord } =
    props;
  const isMultiple = isMultiValueLink(options.relationship);
  const [viewType, setViewType] = useState<ViewType>(ViewType.Unselected);
  const isSelectedView = viewType === ViewType.Selected;

  useImperativeHandle(forwardRef, () => ({
    onReset,
  }));

  const recordQuery = useMemo((): IGetRecordsRo => {
    if (viewType === ViewType.Selected) {
      return {
        filterLinkCellSelected: recordId ? [fieldId, recordId] : fieldId,
      };
    }
    return {
      filterLinkCellCandidate: recordId ? [fieldId, recordId] : fieldId,
    };
  }, [fieldId, recordId, viewType]);

  const base = useBase();
  const table = useTable();
  const baseId = base.id;
  const tableId = table?.id;
  const theme = useGridTheme();
  const { t } = useTranslation();
  const customIcons = useGridIcons();
  const { openTooltip, closeTooltip } = useGridTooltipStore();
  const { columns, cellValue2GridDisplay } = useGridColumns(false);
  const {
    recordMap,
    onForceUpdate,
    onVisibleRegionChanged,
    onReset: onResetRecordMap,
  } = useGridAsyncRecords(undefined, recordQuery);

  const gridRef = useRef<IGridRef>(null);
  const [values, setValues] = useState<ILinkCellValue[]>();
  const [rowCount, setRowCount] = useState<number>(0);

  const componentId = useMemo(() => uniqueId('link-editor-'), []);

  useEffect(() => {
    if (!isEditing) return;
    onForceUpdate();
    if (cellValue == null) return setValues(cellValue);
    setValues(Array.isArray(cellValue) ? cellValue : [cellValue]);
  }, [cellValue, onForceUpdate, isEditing]);

  useEffect(() => {
    rowCount &&
      gridRef.current?.setSelection(
        viewType === ViewType.Unselected
          ? emptySelection
          : new CombinedSelection(SelectionRegionType.Rows, [[0, rowCount - 1]])
      );
  }, [rowCount, viewType]);

  useEffect(() => {
    if (baseId == null || tableId == null) return;

    Table.getRowCount(tableId, recordQuery).then((res) => {
      setRowCount(res.data.rowCount);
    });
  }, [tableId, baseId, recordQuery]);

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

  const onSelectionChanged = useCallback(
    // eslint-disable-next-line sonarjs/cognitive-complexity
    (selection: CombinedSelection) => {
      const { type } = selection;

      if (type === SelectionRegionType.None) {
        if (isSelectedView) {
          return setValues(undefined);
        }
        return cellValue
          ? setValues(Array.isArray(cellValue) ? cellValue : [cellValue])
          : setValues(cellValue);
      }

      if (type !== SelectionRegionType.Rows) return;

      const rowIndexList = selection.flatten();
      const newValues = rowIndexList
        .map((rowIndex) => {
          const record = recordMap[rowIndex];
          const id = record?.id;
          const title = record?.name ?? 'Untitled';
          return { id, title };
        })
        .filter((r) => r.id);

      if (isSelectedView) {
        return setValues(newValues);
      }

      const cv = cellValue == null ? null : Array.isArray(cellValue) ? cellValue : [cellValue];
      return setValues(isMultiple && cv ? [...cv, ...newValues] : newValues);
    },
    [isSelectedView, cellValue, recordMap, isMultiple]
  );

  const onViewShown = (type: ViewType) => {
    if (type === viewType) return;
    onResetRecordMap();
    setViewType(type);
  };

  const onAppendRecord = async () => {
    if (baseId == null || table == null || tableId == null) return;

    const res = await table.createRecord({});
    const record = res.data.records[0];

    if (record != null) {
      onExpandRecord?.(record.id);
    }

    Table.getRowCount(tableId, recordQuery).then((res) => {
      const rowCount = res.data.rowCount;
      setRowCount(() => rowCount);
      gridRef.current?.scrollToItem([0, rowCount - 1]);
    });
  };

  const onReset = () => {
    setValues(undefined);
    setEditing?.(false);
    setViewType(ViewType.Unselected);
    onResetRecordMap();
  };

  const onConfirm = () => {
    onReset();
    if (values == null) return onChange?.(undefined);
    onChange?.(isMultiple ? values : values[0]);
  };

  return (
    <>
      <div className="text-lg">{t('editor.link.placeholder')}</div>
      <div className="flex justify-between">
        <Input className="flex-1" placeholder={t('editor.link.searchPlaceholder')} disabled />
        <div className="ml-4">
          <Tabs defaultValue="unselected" orientation="horizontal" className="flex gap-4">
            <TabsList className="">
              <TabsTrigger
                className="px-4"
                value="unselected"
                onClick={() => onViewShown(ViewType.Unselected)}
              >
                {t('editor.link.unselected')}
              </TabsTrigger>
              <TabsTrigger
                className="px-4"
                value="selected"
                onClick={() => onViewShown(ViewType.Selected)}
              >
                {t('editor.link.selected')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <div className="relative w-full flex-1 overflow-hidden rounded-md border">
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
          rowCount={isSelectedView && !cellValue ? 0 : rowCount ?? 0}
          rowIndexVisible={false}
          customIcons={customIcons}
          draggable={DraggableType.None}
          selectable={SelectableType.Row}
          isMultiSelectionEnable={isMultiple}
          onItemHovered={onItemHovered}
          getCellContent={getCellContent}
          onSelectionChanged={onSelectionChanged}
          onVisibleRegionChanged={onVisibleRegionChanged}
        />
        <GridTooltip id={componentId} />
      </div>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={onAppendRecord}>
          <Plus className="size-4" />
          {t('editor.link.create')}
        </Button>
        <div>
          <Button variant="outline" onClick={onReset}>
            {t('common.cancel')}
          </Button>
          <Button className="ml-4" onClick={onConfirm}>
            {t('common.confirm')}
          </Button>
        </div>
      </div>
    </>
  );
};

const LinkEditorInner = forwardRef(LinkEditorInnerBase);

const LinkEditorMainBase: ForwardRefRenderFunction<ILinkEditorMainRef, ILinkEditorMainProps> = (
  props,
  forwardRef
) => {
  const { options } = props;
  const tableId = options.foreignTableId;

  return (
    <AnchorProvider tableId={tableId}>
      <LinkEditorInner ref={forwardRef} {...props} />
    </AnchorProvider>
  );
};

export const LinkEditorMain = forwardRef(LinkEditorMainBase);
