import type { FieldType, DbFieldType } from '../constant';
import type { CellValueType } from '../field';
import { FieldCore } from '../field';

export enum Relationship {
  Many = 'many',
  OneMany = 'oneMany',
  ManyOne = 'manyOne',
}

export interface ILinkCellValue {
  title?: string;
  id: string;
}

export class LinkFieldOptions {
  /**
   * describe the relationship from this table to the foreign table
   */
  relationship!: Relationship;

  /**
   * the table this field is linked to
   */
  foreignTableId!: string;

  /**
   * The value of the lookup Field in the associated table will be displayed as the current field.
   */
  lookupFieldId!: string;

  /**
   * The foreign key field name used to store values in the db table.
   */
  dbForeignKeyName!: string;

  /**
   * the symmetric field in the foreign table.
   */
  symmetricFieldId!: string;
}

export class LinkFieldCore extends FieldCore {
  type!: FieldType.Link;

  dbFieldType!: DbFieldType.Json;

  options!: LinkFieldOptions;

  defaultValue!: null;

  calculatedType!: FieldType.Link;

  cellValueType!: CellValueType.Array | CellValueType.String;

  declare cellValueElementType?: CellValueType.String;

  isComputed!: true;

  cellValue2String(cellValue: ILinkCellValue | ILinkCellValue[]) {
    if (Array.isArray(cellValue)) {
      return cellValue.map((v) => v.title || '').join(', ');
    }
    return cellValue.title || '';
  }

  convertStringToCellValue(_value: string): string[] | null {
    return null;
  }

  repair(value: unknown) {
    return value;
  }
}
