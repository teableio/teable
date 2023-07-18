import type { GridCell, GridColumn } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { CellValueType, FieldType } from '@teable-group/core';
import { useFields, useViewId } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { useMemo } from 'react';

const generateColumns = (
  fields: IFieldInstance[],
  viewId?: string
): (GridColumn & {
  id: string;
})[] => {
  if (!viewId) {
    return [];
  }

  return fields.map((field) => {
    const columnMeta = field.columnMeta[viewId];
    const width = columnMeta?.width || 150;
    const iconString = (type: FieldType, isLookup: boolean | undefined) => {
      return isLookup ? `${type}_lookup` : type;
    };
    switch (field.type) {
      case FieldType.SingleLineText:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: iconString(FieldType.SingleLineText, field.isLookup),
          kind: GridCellKind.Text,
          hasMenu: true,
        };
      case FieldType.SingleSelect:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: iconString(FieldType.SingleSelect, field.isLookup),
          kind: GridCellKind.Bubble,
          hasMenu: true,
        };
      case FieldType.Number:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: iconString(FieldType.Number, field.isLookup),
          kind: GridCellKind.Number,
          hasMenu: true,
        };
      case FieldType.MultipleSelect:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: iconString(FieldType.MultipleSelect, field.isLookup),
          kind: GridCellKind.Bubble,
          hasMenu: true,
        };
      case FieldType.Link:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: iconString(FieldType.Link, field.isLookup),
          kind: GridCellKind.Bubble,
          hasMenu: true,
        };
      case FieldType.Formula:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: iconString(FieldType.Formula, field.isLookup),
          kind: GridCellKind.Text,
          hasMenu: true,
        };
      case FieldType.Attachment:
        return {
          id: field.id,
          title: field.name,
          icon: iconString(FieldType.Attachment, field.isLookup),
          kind: GridCellKind.Custom,
          hasMenu: true,
          width,
        };
      case FieldType.Date:
        return {
          id: field.id,
          title: field.name,
          icon: iconString(FieldType.Date, field.isLookup),
          kind: GridCellKind.Custom,
          hasMenu: true,
          width,
        };
      case FieldType.Checkbox:
        return {
          id: field.id,
          title: field.name,
          icon: iconString(FieldType.Checkbox, field.isLookup),
          kind: GridCellKind.Boolean,
          hasMenu: true,
          width,
        };
      case FieldType.Rollup:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: iconString(FieldType.Rollup, field.isLookup),
          kind: GridCellKind.Text,
          hasMenu: true,
        };
    }
  });
};

function getBasicCell(field: IFieldInstance, cellValue: unknown): GridCell {
  const isNumberCell = field.cellValueType === CellValueType.Number && !field.isMultipleCellValue;
  const isDateCell = field.cellValueType === CellValueType.DateTime && !field.isMultipleCellValue;
  const isBooleanCell = field.cellValueType === CellValueType.Boolean && !field.isMultipleCellValue;
  if (isNumberCell) {
    return {
      kind: GridCellKind.Number,
      data: (cellValue as number) || undefined,
      allowOverlay: true,
      displayData: field.cellValue2String(cellValue as number),
      contentAlign: 'right',
      themeOverride: { fontFamily: '"everson mono", courier, consolas, monaco, monospace' },
      readonly: field.isComputed,
    };
  }
  if (isDateCell) {
    const text = field.cellValue2String(cellValue as number);
    return {
      kind: GridCellKind.Custom,
      data: {
        type: FieldType.Date,
        value: text,
      },
      copyData: text,
      allowOverlay: true,
      readonly: field.isComputed,
    };
  }
  if (isBooleanCell) {
    return {
      kind: GridCellKind.Boolean,
      data: (cellValue as boolean) || false,
      allowOverlay: false,
      contentAlign: 'center',
      readonly: field.isComputed,
    };
  }

  const text = field.cellValue2String(cellValue);
  return {
    kind: GridCellKind.Text,
    data: text,
    allowOverlay: true,
    displayData: text,
    readonly: field.isComputed,
  };
}

const createCellValue2GridDisplay =
  (fields: IFieldInstance[]) =>
  // eslint-disable-next-line sonarjs/cognitive-complexity
  (cellValue: unknown, col: number): GridCell => {
    const field = fields[col];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any

    switch (field.type) {
      case FieldType.SingleLineText:
      case FieldType.Number:
      case FieldType.Rollup:
      case FieldType.Formula:
      case FieldType.Date:
      case FieldType.Checkbox: {
        return getBasicCell(field, cellValue);
      }
      case FieldType.SingleSelect: {
        return {
          kind: GridCellKind.Custom,
          data: {
            type: field.isMultipleCellValue ? FieldType.MultipleSelect : FieldType.SingleSelect,
            options: field.options,
            value: Array.isArray(cellValue) ? cellValue : cellValue ? [cellValue] : [],
          },
          copyData: `${col}`,
          allowOverlay: true,
          readonly: field.isComputed,
        };
      }
      case FieldType.MultipleSelect: {
        return {
          kind: GridCellKind.Custom,
          data: {
            type: FieldType.MultipleSelect,
            options: field.options,
            value: cellValue ? cellValue : [],
          },
          copyData: `${col}`,
          allowOverlay: true,
          readonly: field.isComputed,
        };
      }
      case FieldType.Link: {
        const cellString: string[] = Array.isArray(cellValue)
          ? cellValue.map((l) => l.title || 'Untitled')
          : cellValue
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [(cellValue as any).title || 'Untitled']
          : [];
        return {
          kind: GridCellKind.Custom,
          data: {
            type: FieldType.Link,
            value: cellString ? cellString : [],
          },
          copyData: `${col}`,
          allowOverlay: true,
          readonly: field.isLookup,
        };
      }
      case FieldType.Attachment: {
        return {
          kind: GridCellKind.Custom,
          data: {
            type: FieldType.Attachment,
            options: field.options,
            value: cellValue ?? [],
          },
          copyData: `${col}`,
          allowOverlay: true,
          readonly: field.isComputed,
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
      cellValue2GridDisplay: createCellValue2GridDisplay(fields),
    }),
    [fields, viewId]
  );
}
