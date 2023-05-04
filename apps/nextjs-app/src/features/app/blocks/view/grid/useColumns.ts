import type { GridCell, GridColumn, Theme } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';
import { ColorUtils, FieldType } from '@teable-group/core';
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
    switch (field.type) {
      case FieldType.SingleLineText:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: FieldType.SingleLineText,
          kind: GridCellKind.Text,
          hasMenu: true,
        };
      case FieldType.SingleSelect:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: FieldType.SingleSelect,
          kind: GridCellKind.Bubble,
          hasMenu: true,
        };
      case FieldType.Number:
        return {
          id: field.id,
          title: field.name,
          width,
          icon: FieldType.Number,
          kind: GridCellKind.Number,
          hasMenu: true,
        };
    }
  });
};

const createCellValue2GridDisplay =
  (fields: IFieldInstance[]) =>
  (cellValue: unknown, col: number): GridCell => {
    const field = fields[col];

    switch (field.type) {
      case FieldType.SingleLineText: {
        return {
          kind: GridCellKind.Text,
          data: (cellValue as string) || '',
          allowOverlay: true,
          displayData: (cellValue as string) || '',
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
        };
      }
      case FieldType.SingleSelect: {
        const color = field.options.choices.find((choice) => choice.name === cellValue)?.color;
        const themeOverride: Partial<Theme> | undefined = color
          ? {
              bgBubble: ColorUtils.getHexForColor(color),
              textDark: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
            }
          : undefined;
        return {
          kind: GridCellKind.Custom,
          data: {
            type: FieldType.SingleSelect,
            options: field.options,
            value: cellValue ? [cellValue as string] : [],
          },
          copyData: `${col}`,
          allowOverlay: true,
          themeOverride,
        };
      }
    }
  };

export function useColumns() {
  const viewId = useViewId();
  const { fields } = useFields();

  return useMemo(
    () => ({
      columns: generateColumns(fields, viewId),
      cellValue2GridDisplay: createCellValue2GridDisplay(fields),
    }),
    [fields, viewId]
  );
}
