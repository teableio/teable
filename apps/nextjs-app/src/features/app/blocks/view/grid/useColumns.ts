import type { GridCell, GridColumn } from '@glideapps/glide-data-grid';
import { GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid';
import { FieldType } from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { useCallback, useMemo } from 'react';

export function useColumns(fields: IFieldInstance[]) {
  const columns: (GridColumn & {
    id: string;
  })[] = useMemo(() => {
    return fields.map((field) => {
      console.log('fieldInstance', field);
      switch (field.type) {
        case FieldType.SingleLineText:
          return {
            id: field.id,
            title: field.name,
            width: 400,
            icon: GridColumnIcon.HeaderString,
            kind: GridCellKind.Text,
          };
        case FieldType.SingleSelect:
          return {
            id: field.id,
            title: field.name,
            width: 100,
            icon: GridColumnIcon.HeaderArray,
            kind: GridCellKind.Text,
          };
        case FieldType.Number:
          return {
            id: field.id,
            title: field.name,
            width: 100,
            icon: GridColumnIcon.HeaderNumber,
            kind: GridCellKind.Text,
          };
      }
    });
  }, [fields]);

  const cellValue2GridDisplay = useCallback(
    (cellValue: unknown, col: number): GridCell => {
      const field = fields[col];
      return {
        kind: GridCellKind.Text,
        data: String(cellValue) || '',
        allowOverlay: true,
        displayData: String(cellValue) || '',
      };
    },
    [fields]
  );
  return { columns, cellValue2GridDisplay };
}
