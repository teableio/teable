import { LinkFieldCore } from '@teable-group/core';
import type { ILinkCellValue } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class LinkFieldDto extends LinkFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    return value && JSON.stringify(value);
  }

  convertDBValue2CellValue(value: string): unknown {
    return value && JSON.parse(value);
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
        title: titles[i],
      }));
    }
    return {
      id: (value as ILinkCellValue).id,
      title: title as string,
    };
  }
}
