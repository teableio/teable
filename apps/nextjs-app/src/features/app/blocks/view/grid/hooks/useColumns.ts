import { FieldType } from '@teable-group/core';
import { useFields, useViewId } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { useMemo } from 'react';
import type { IColumn } from '../../../grid';
import type { IInnerCell } from '../../../grid/renderers';
import { CellType } from '../../../grid/renderers';

const generateColumns = (
  fields: IFieldInstance[],
  viewId?: string
): (IColumn & { id: string })[] => {
  if (!viewId) {
    return [];
  }

  const iconString = (type: FieldType, isLookup: boolean | undefined) => {
    return isLookup ? `${type}_lookup` : type;
  };

  return fields.map((field) => {
    const columnMeta = field.columnMeta[viewId];
    const width = columnMeta?.width || 150;
    const { id, type, name, isLookup } = field;
    switch (type) {
      case FieldType.SingleLineText:
        return {
          id,
          name,
          width,
          icon: iconString(FieldType.SingleLineText, isLookup),
          hasMenu: true,
        };
      case FieldType.SingleSelect:
        return {
          id,
          name,
          width,
          icon: iconString(FieldType.SingleSelect, isLookup),
          hasMenu: true,
        };
      case FieldType.Number:
        return {
          id,
          name,
          width,
          icon: iconString(FieldType.Number, isLookup),
          hasMenu: true,
        };
      case FieldType.MultipleSelect:
        return {
          id,
          name,
          width,
          icon: iconString(FieldType.MultipleSelect, isLookup),
          hasMenu: true,
        };
      case FieldType.Link:
        return {
          id,
          name,
          width,
          icon: iconString(FieldType.Link, isLookup),
          hasMenu: true,
        };
      case FieldType.Formula:
        return {
          id,
          name,
          width,
          icon: iconString(FieldType.Formula, isLookup),
        };
      case FieldType.Attachment:
        return {
          id,
          name,
          icon: iconString(FieldType.Attachment, isLookup),
          hasMenu: true,
          width,
        };
      case FieldType.Date:
        return {
          id,
          name,
          icon: iconString(FieldType.Date, isLookup),
          hasMenu: true,
          width,
        };
    }
  });
};

const createNewCellValue2GridDisplay =
  (fields: IFieldInstance[]) =>
  (cellValue: unknown, col: number): IInnerCell => {
    const field = fields[col];

    switch (field?.type) {
      case FieldType.SingleLineText: {
        return {
          type: CellType.Text,
          data: (cellValue as string) || '',
          displayData: (cellValue as string) || '',
          readonly: field.isComputed,
        };
      }
      case FieldType.Number: {
        return {
          type: CellType.Number,
          data: (cellValue as number) || undefined,
          displayData: field.cellValue2String(cellValue as number),
          contentAlign: 'right',
          readonly: field.isComputed,
        };
      }
      case FieldType.MultipleSelect:
      case FieldType.SingleSelect: {
        return {
          type: CellType.Select,
          data: {
            options: field.options,
            value: cellValue ? (Array.isArray(cellValue) ? cellValue : [cellValue]) : [],
          },
          isMultiple: field.isMultipleCellValue,
          readonly: field.isComputed,
        };
      }
      default: {
        return {
          type: CellType.Text,
          data: '',
          displayData: '',
        };
      }
    }
  };

export function useColumns() {
  const viewId = useViewId();
  const fields = useFields();

  return useMemo(
    () => ({
      columns: generateColumns(fields, viewId),
      cellValue2GridDisplay: createNewCellValue2GridDisplay(fields),
    }),
    [fields, viewId]
  );
}
