import type { GridCell, GridColumn } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { FieldType } from '@teable-group/core';
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
    }
  });
};

const createCellValue2GridDisplay =
  (fields: IFieldInstance[]) =>
  // eslint-disable-next-line sonarjs/cognitive-complexity
  (cellValue: unknown, col: number): GridCell => {
    const field = fields[col];

    switch (field.type) {
      case FieldType.SingleLineText: {
        return {
          kind: GridCellKind.Text,
          data: (cellValue as string) || '',
          allowOverlay: true,
          displayData: (cellValue as string) || '',
          readonly: field.isComputed,
        };
      }
      case FieldType.Number: {
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
      case FieldType.SingleSelect: {
        return {
          kind: GridCellKind.Custom,
          data: {
            type: FieldType.SingleSelect,
            options: field.options,
            value: cellValue ? [cellValue as string] : [],
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
      case FieldType.Formula: {
        return {
          kind: GridCellKind.Text,
          data: cellValue ? (String(cellValue) as string) : '',
          allowOverlay: true,
          displayData: cellValue ? (String(cellValue) as string) : '',
          readonly: field.isComputed,
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
      case FieldType.Date: {
        return {
          kind: GridCellKind.Custom,
          data: {
            type: FieldType.Date,
            value: field.cellValue2String(cellValue as number),
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
