import { z } from 'zod';
import type { FieldType, DbFieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export enum Relationship {
  ManyMany = 'manyMany',
  OneMany = 'oneMany',
  ManyOne = 'manyOne',
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const RelationshipRevert = {
  [Relationship.OneMany]: Relationship.ManyOne,
  [Relationship.ManyOne]: Relationship.OneMany,
  [Relationship.ManyMany]: Relationship.ManyMany,
};

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

export type ILinkFieldOptionsRo = Pick<LinkFieldOptions, 'relationship' | 'foreignTableId'>;

export class LinkFieldCore extends FieldCore {
  static defaultOptions(): Partial<LinkFieldOptions> {
    return {};
  }

  type!: FieldType.Link;

  dbFieldType!: DbFieldType.Text;

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

  validateOptions() {
    return z
      .object({
        relationship: z.nativeEnum(Relationship),
        foreignTableId: z.string(),
        lookupFieldId: z.string(),
        dbForeignKeyName: z.string(),
        symmetricFieldId: z.string(),
      })
      .safeParse(this.options);
  }

  validateDefaultValue() {
    return z.null().optional().safeParse(this.defaultValue);
  }
}
