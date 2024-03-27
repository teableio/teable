import { LinkFieldCore } from '@teable/core';
import type { ILinkCellValue } from '@teable/core';
import type { IFieldBase } from '../field-base';

export class LinkFieldDto extends LinkFieldCore implements IFieldBase {
  isStructuredCellValue = true;

  convertCellValue2DBValue(value: unknown): unknown {
    return value && JSON.stringify(value);
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
  }

  updateCellTitle(
    value: ILinkCellValue | ILinkCellValue[],
    title: string | null | (string | null)[]
  ) {
    if (this.isMultipleCellValue) {
      const values = value as ILinkCellValue[];
      const titles = title as string[];
      return values.map((v, i) => ({
        id: v.id,
        title: titles[i] || undefined,
      }));
    }
    return {
      id: (value as ILinkCellValue).id,
      title: (title as string | null) || undefined,
    };
  }

  override convertStringToCellValue(value: string): string[] | null {
    const cellValue = value.split(/[,\n\r]\s*/);
    if (cellValue.length) {
      return cellValue;
    }
    return null;
  }
}
