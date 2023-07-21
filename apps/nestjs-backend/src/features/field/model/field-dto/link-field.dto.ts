import { CellValueType, DbFieldType, LinkFieldCore, Relationship } from '@teable-group/core';
import type {
  ILinkFieldOptions,
  ILinkCellValue,
  ILookupOptionsVo,
  IFieldRo,
} from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { IFieldBase } from '../field-base';

export class LinkFieldDto extends LinkFieldCore implements IFieldBase {
  static factory(fieldRo: IFieldRo) {
    const isMultipleCellValue =
      fieldRo.lookupOptions &&
      (fieldRo.lookupOptions as ILookupOptionsVo).relationship !== Relationship.ManyOne;

    const options = fieldRo.options as ILinkFieldOptions | undefined;

    return plainToInstance(LinkFieldDto, {
      ...fieldRo,
      isComputed: fieldRo.isLookup,
      cellValueType: CellValueType.String,
      isMultipleCellValue: options?.relationship !== Relationship.ManyOne || isMultipleCellValue,
      dbFieldType: DbFieldType.Json,
    } as LinkFieldDto);
  }

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
