import { useQuery } from '@tanstack/react-query';
import { generateFieldId } from '@teable/core';
import type { FieldType, ILinkCellValue } from '@teable/core';
import { getRecords, McpToolInvocationName } from '@teable/openapi';
import type {
  ICreateRecordsRo,
  IDeleteRecordsToolParams,
  IGetRecordsRo,
  IUpdateRecordsRo,
  IUpdateRecordsToolParams,
} from '@teable/openapi';
import type {
  ICellItem,
  IGridRef,
  CombinedSelection,
  ICell,
  IRecordIndexMap,
  IGridColumn,
} from '@teable/sdk/components';
import {
  CellType,
  Grid,
  hexToRGBA,
  useGridAsyncRecords,
  useGridColumns,
  useGridIcons,
  useGridTheme,
} from '@teable/sdk/components';
import { useFields, useRowCount } from '@teable/sdk/hooks';
import type { IFieldInstance, Record as IRecordInstance } from '@teable/sdk/model';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { IToolMessagePart } from '../ToolMessagePart';
import { PreviewActionColorMap } from './constant';

interface IGridPreviewProps {
  hiddenFieldIds?: string[];
  readonly?: boolean;
  isMultiple?: boolean;
  recordQuery?: IGetRecordsRo;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  onChange?: (value?: ILinkCellValue[]) => void;
  toolInvocation: IToolMessagePart['part']['toolInvocation'];
}

export interface IGridPreviewRef {
  onReset: () => void;
  onForceUpdate: () => void;
  setSelection: (selection: CombinedSelection) => void;
  scrollToItem: (position: [columnIndex: number, rowIndex: number]) => void;
}

const GridPreviewBase: ForwardRefRenderFunction<IGridPreviewRef, IGridPreviewProps> = (
  props,
  forwardRef
) => {
  const { recordQuery, hiddenFieldIds, toolInvocation } = props;
  const rowCount = useRowCount() || 0;
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
  const { columns, cellValue2GridDisplay } = useGridColumns(false, hiddenFieldIds);

  const allFields = useFields();
  const fieldMap = allFields.reduce(
    (acc, field) => {
      acc[field.id] = field;
      return acc;
    },
    {} as Record<string, IFieldInstance>
  );

  const fieldMapWithName = useMemo(() => {
    return allFields.reduce(
      (acc, field) => {
        acc[field.id] = field;
        acc[field.name] = field;
        return acc;
      },
      {} as Record<string, IFieldInstance>
    );
  }, [allFields]);

  const deleteRecordIds = useMemo(() => {
    const toolName = toolInvocation.toolName as McpToolInvocationName;
    if (toolName !== McpToolInvocationName.DeleteRecords) return [];
    const deleteRecords = toolInvocation?.args;
    const { recordIds } = deleteRecords as IDeleteRecordsToolParams;
    return recordIds;
  }, [toolInvocation]);

  const updateRecordIds = useMemo(() => {
    const toolName = toolInvocation.toolName as McpToolInvocationName;
    if (toolName !== McpToolInvocationName.UpdateRecords) return [];
    const updateRecords = toolInvocation?.args;
    const {
      updateRecordsRo: { records },
    } = updateRecords as IUpdateRecordsToolParams;
    return records.map((record) => record.id);
  }, [toolInvocation]);

  const finalRowCount = useMemo(() => {
    switch (toolInvocation.toolName) {
      case McpToolInvocationName.DeleteRecords: {
        return deleteRecordIds.length;
      }
      case McpToolInvocationName.CreateRecords: {
        const createRecords = toolInvocation.args?.createRecordsRo;
        const { records } = createRecords as ICreateRecordsRo;
        return records.length;
      }
      case McpToolInvocationName.UpdateRecords: {
        const updateRecords = toolInvocation.args?.updateRecordsRo;
        const { records } = updateRecords as IUpdateRecordsRo;
        return records.length;
      }
      default: {
        return rowCount;
      }
    }
  }, [
    deleteRecordIds.length,
    rowCount,
    toolInvocation.args?.createRecordsRo,
    toolInvocation.args?.updateRecordsRo,
    toolInvocation.toolName,
  ]);

  const { data: deleteRecords } = useQuery({
    queryKey: [
      'deleteRecordIds',
      deleteRecordIds,
      toolInvocation.args?.tableId,
      toolInvocation.toolCallId,
    ],
    queryFn: () => {
      return getRecords(toolInvocation.args?.tableId, { selectedRecordIds: deleteRecordIds });
    },
    enabled: Boolean(deleteRecordIds?.length),
  });

  const { data: updateRecords } = useQuery({
    queryKey: [
      'updateRecordIds',
      updateRecordIds,
      toolInvocation.args?.tableId,
      toolInvocation.toolCallId,
    ],
    queryFn: () => {
      return getRecords(toolInvocation.args?.tableId, { selectedRecordIds: updateRecordIds });
    },
    enabled: Boolean(updateRecordIds?.length),
  });

  const searchHitIndex = useMemo(() => {
    const toolName = toolInvocation.toolName as McpToolInvocationName;

    if (toolName !== McpToolInvocationName.UpdateRecords) return undefined;
    const {
      updateRecordsRo: { records },
    } = toolInvocation.args as IUpdateRecordsToolParams;

    if (!records) return undefined;

    const searchHitIndex: { fieldId: string; recordId: string }[] = [];
    for (const record of records) {
      const fieldMap = record.fields;
      Object.keys(fieldMap).forEach((key) => {
        const field = fieldMapWithName[key];
        if (field) {
          searchHitIndex.push({
            fieldId: field.id,
            recordId: record.id,
          });
        }
      });
    }

    return searchHitIndex;
  }, [fieldMapWithName, toolInvocation.args, toolInvocation.toolName]);

  const gridRef = useRef<IGridRef>(null);
  const rowCountRef = useRef<number>(rowCount);
  rowCountRef.current = rowCount;

  const { recordMap, onReset, onForceUpdate } = useGridAsyncRecords(undefined, recordQuery);

  const finalColumns = useMemo(() => {
    const toolName = toolInvocation.toolName as McpToolInvocationName;
    switch (toolName) {
      case McpToolInvocationName.DeleteFields: {
        const fieldIds = toolInvocation.args?.['fieldIds'];
        return columns.map((column) => {
          const theme = fieldIds.includes(column.id)
            ? {
                columnHeaderBgHovered: hexToRGBA(PreviewActionColorMap['delete'], 0.5),
                columnHeaderBg: hexToRGBA(PreviewActionColorMap['delete'], 0.3),
                cellBg: hexToRGBA(PreviewActionColorMap['delete'], 0.3),
                cellBgHovered: hexToRGBA(PreviewActionColorMap['delete'], 0.5),
              }
            : column.customTheme;
          return {
            ...column,
            customTheme: theme,
          };
        });
      }
      case McpToolInvocationName.CreateFields: {
        const { state } = toolInvocation;
        const createFields = toolInvocation.args?.['fields'] as {
          name: string;
          type: FieldType;
          id?: string;
        }[];
        const names = createFields.map(({ name }) => name);
        if (state === 'result') {
          return columns.map((column) => {
            return {
              ...column,
              customTheme: names?.includes(column.name)
                ? {
                    columnHeaderBgHovered: hexToRGBA(PreviewActionColorMap['create'], 0.5),
                    columnHeaderBg: hexToRGBA(PreviewActionColorMap['create'], 0.3),
                  }
                : undefined,
            };
          });
        }
        const newColumns = createFields.map((column) => {
          return {
            ...column,
            name: createFields.find(({ id }) => id === column.id)?.name,
            icon: createFields.find(({ id }) => id === column.id)?.type,
            id: generateFieldId(),
            customTheme: {
              columnHeaderBgHovered: hexToRGBA(PreviewActionColorMap['create'], 0.5),
              columnHeaderBg: hexToRGBA(PreviewActionColorMap['create'], 0.3),
            },
          };
        });
        return [...columns, ...newColumns];
      }
      case McpToolInvocationName.UpdateField: {
        const { fieldId, updateFieldRo } = toolInvocation.args;
        return columns.map((column) => {
          const theme =
            fieldId === column.id
              ? {
                  columnHeaderBgHovered: hexToRGBA(PreviewActionColorMap['update'], 0.5),
                  columnHeaderBg: hexToRGBA(PreviewActionColorMap['update'], 0.3),
                }
              : column.customTheme;
          return {
            ...column,
            customTheme: theme,
            name: fieldId === column.id ? updateFieldRo?.name || column.name : column.name,
            icon: fieldId === column.id ? updateFieldRo?.type || column.icon : column.icon,
          };
        });
      }
      case McpToolInvocationName.CreateRecords: {
        return columns.map((column) => {
          return {
            ...column,
            id: generateFieldId(),
            name: column.name || '',
            customTheme: {
              cellBg: hexToRGBA(PreviewActionColorMap['create'], 0.3),
              cellBgHovered: hexToRGBA(PreviewActionColorMap['create'], 0.5),
            },
          };
        });
      }
      case McpToolInvocationName.UpdateRecords: {
        return columns.map((column) => {
          return {
            ...column,
            customTheme: {
              searchTargetIndexBg: hexToRGBA(PreviewActionColorMap['create'], 0.5),
            },
          };
        });
      }
      case McpToolInvocationName.DeleteRecords: {
        return columns.map((column) => {
          return {
            ...column,
            name: column.name || '',
            customTheme: {
              cellBg: hexToRGBA(PreviewActionColorMap['delete'], 0.3),
              cellBgHovered: hexToRGBA(PreviewActionColorMap['delete'], 0.5),
            },
          };
        });
      }
      default: {
        return columns;
      }
    }
  }, [columns, toolInvocation]);

  useEffect(() => {
    switch (toolInvocation.toolName) {
      case McpToolInvocationName.CreateFields: {
        const columnIndex = columns.length + 1;
        gridRef.current?.scrollToItem([columnIndex, 0]);
        break;
      }
      case McpToolInvocationName.DeleteFields: {
        const fieldIds = toolInvocation.args?.['fieldIds'];
        const firstFieldId = fieldIds[0];
        const columnIndex = finalColumns.findIndex((column) => column.id === firstFieldId);
        columnIndex > -1 && gridRef.current?.scrollToItem([columnIndex, 0]);
        break;
      }
      case McpToolInvocationName.UpdateField: {
        const { fieldId } = toolInvocation.args;
        const columnIndex = finalColumns.findIndex((column) => column.id === fieldId);
        gridRef.current?.scrollToItem([columnIndex, 0]);
        break;
      }
      default: {
        break;
      }
    }
  }, [columns.length, finalColumns, toolInvocation.args, toolInvocation.toolName]);

  const finalRecordMap = useMemo(() => {
    const toolName = toolInvocation.toolName as McpToolInvocationName;
    switch (toolName) {
      case McpToolInvocationName.CreateRecords: {
        const createRecords = toolInvocation.args?.createRecordsRo;
        const { records, fieldKeyType } = createRecords as ICreateRecordsRo;

        if (!fieldMap || !allFields) return recordMap;

        const newRecords = records.map((record, index) => ({
          autoNumber: index + 1,
          name: '',
          fieldMap,
          fields: allFields,
          isLocked: () => {
            return false;
          },
          isHidden: () => {
            return false;
          },
          getCellValue: (fieldId: string) => {
            const field = fieldMap[fieldId];
            const key = fieldKeyType === 'id' ? 'id' : 'name';
            const keyValue = field[key];
            if (!field) return '';
            return field.cellValue2String(record?.fields?.[keyValue]);
          },
        })) as unknown as IRecordInstance[];
        return newRecords.reduce((acc: IRecordIndexMap, record: IRecordInstance, index: number) => {
          acc[index] = record;
          return acc;
        }, {} as IRecordIndexMap);
      }
      case McpToolInvocationName.UpdateRecords: {
        if (!updateRecords?.data?.records?.length) return recordMap;
        const {
          updateRecordsRo: { records },
        } = toolInvocation.args as IUpdateRecordsToolParams;

        if (!records || !allFields || !fieldMap) return recordMap;

        const newRecords = records.map((record, index) => ({
          id: record.id,
          autoNumber: index + 1,
          name: '',
          fieldMap,
          fields: allFields,
          isLocked: () => {
            return false;
          },
          isHidden: () => {
            return false;
          },
          getCellValue: (fieldId: string) => {
            const field = fieldMap[fieldId];
            const name = field.name;
            const id = field.id;

            if (!field) return '';
            const recordField = updateRecords?.data?.records?.find(
              ({ id: recordId }) => record.id === recordId
            );
            const value =
              record?.fields?.[name] ??
              record?.fields?.[id] ??
              recordField?.fields?.[name] ??
              recordField?.fields?.[id];
            const cellValueString = field.cellValue2String(value);
            return field.convertStringToCellValue(cellValueString);
          },
        })) as unknown as IRecordInstance[];
        return newRecords.reduce((acc: IRecordIndexMap, record: IRecordInstance, index: number) => {
          acc[index] = record;
          return acc;
        }, {} as IRecordIndexMap);
      }
      case McpToolInvocationName.DeleteRecords: {
        if (!deleteRecords?.data?.records?.length) return recordMap;

        const newRecords = deleteRecords.data.records.map((record, index) => ({
          id: record.id,
          autoNumber: index + 1,
          name: '',
          fieldMap,
          fields: allFields,
          isLocked: () => {
            return false;
          },
          isHidden: () => {
            return false;
          },
          getCellValue: (fieldId: string) => {
            const field = fieldMap[fieldId];
            const key = 'name';
            const keyValue = field[key];
            if (!field) return '';
            return field.cellValue2String(record?.fields?.[keyValue]);
          },
        })) as unknown as IRecordInstance[];
        return newRecords.reduce((acc: IRecordIndexMap, record: IRecordInstance, index: number) => {
          acc[index] = record;
          return acc;
        }, {} as IRecordIndexMap);
      }
      case McpToolInvocationName.CreateField: {
        return recordMap;
      }
      default: {
        return recordMap;
      }
    }
  }, [
    toolInvocation.toolName,
    toolInvocation.args,
    fieldMap,
    allFields,
    recordMap,
    updateRecords?.data,
    deleteRecords?.data?.records,
  ]);

  const finalTheme = useMemo(() => {
    const toolName = toolInvocation.toolName as McpToolInvocationName;
    return toolName === McpToolInvocationName.UpdateRecords
      ? { ...theme, searchTargetIndexBg: hexToRGBA(PreviewActionColorMap['update'], 0.5) }
      : theme;
  }, [theme, toolInvocation.toolName]);

  useEffect(() => {
    if (!rowCount) return;
  }, [rowCount]);

  const getCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell: ICellItem) => {
      const [colIndex, rowIndex] = cell;
      const record = finalRecordMap[rowIndex];
      if (record !== undefined) {
        const fieldId = finalColumns[colIndex]?.id;
        if (!fieldId) return { type: CellType.Loading };
        return cellValue2GridDisplay(record, colIndex);
      }
      return { type: CellType.Loading };
    },
    [finalRecordMap, finalColumns, cellValue2GridDisplay]
  );

  if (columns?.length === 0) return null;

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
        theme={finalTheme}
        columns={finalColumns as unknown as IGridColumn[]}
        rowCount={finalRowCount}
        rowIndexVisible={false}
        customIcons={customIcons}
        rowControls={[]}
        getCellContent={getCellContent}
        searchHitIndex={searchHitIndex}
      />
    </>
  );
};

export const GridPreView = forwardRef(GridPreviewBase);
