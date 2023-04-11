import type { GridCell, GridColumn, Theme } from '@glideapps/glide-data-grid';
import { GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid';
import { ColorUtils, FieldType } from '@teable-group/core';
import { useFields, useViewId } from '@teable-group/sdk/hooks';
import { useCallback, useEffect, useState } from 'react';

export function useColumns() {
  const viewId = useViewId();
  const { fields } = useFields();

  const generateColumns = useCallback((): (GridColumn & {
    id: string;
  })[] => {
    if (!viewId) {
      return [];
    }

    return fields.map((field) => {
      const columnMeta = field.columnMeta[viewId];
      const width = columnMeta.width || 200;
      switch (field.type) {
        case FieldType.SingleLineText:
          return {
            id: field.id,
            title: field.name,
            width,
            icon: GridColumnIcon.HeaderString,
            kind: GridCellKind.Text,
          };
        case FieldType.SingleSelect:
          return {
            id: field.id,
            title: field.name,
            width,
            icon: GridColumnIcon.HeaderArray,
            kind: GridCellKind.Bubble,
          };
        case FieldType.Number:
          return {
            id: field.id,
            title: field.name,
            width,
            icon: GridColumnIcon.HeaderNumber,
            kind: GridCellKind.Number,
          };
      }
    });
  }, [fields, viewId]);

  const [columns, setColumns] = useState(generateColumns);

  useEffect(() => {
    setColumns(generateColumns());
  }, [generateColumns]);

  const cellValue2GridDisplay = useCallback(
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
                textBubble: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
                bgBubbleSelected: ColorUtils.getHexForColor(color),
              }
            : undefined;
          return {
            kind: GridCellKind.Bubble,
            data: cellValue ? [cellValue as string] : [],
            allowOverlay: true,
            themeOverride,
          };
        }
      }
    },
    [fields]
  );

  return { columns, setColumns, cellValue2GridDisplay };
}
