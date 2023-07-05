import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
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

export const linkFieldOptionsDef = z.object({
  /**
   * describe the relationship from this table to the foreign table
   */
  relationship: z.nativeEnum(Relationship),
  /**
   * the table this field is linked to
   */
  foreignTableId: z.string(),
  /**
   * The value of the lookup Field in the associated table will be displayed as the current field.
   */
  lookupFieldId: z.string(),
  /**
   * The foreign key field name used to store values in the db table.
   */
  dbForeignKeyName: z.string(),
  /**
   * the symmetric field in the foreign table.
   */
  symmetricFieldId: z.string(),
});

export type ILinkFieldOptions = z.infer<typeof linkFieldOptionsDef>;

export type ILinkFieldOptionsRo = Pick<ILinkFieldOptions, 'relationship' | 'foreignTableId'>;

export class LinkFieldCore extends FieldCore {
  static defaultOptions(): Partial<ILinkFieldOptions> {
    return {};
  }

  type!: FieldType.Link;

  options!: ILinkFieldOptions;

  defaultValue!: null;

  cellValueType!: CellValueType.String;

  declare isMultipleCellValue?: boolean | undefined;

  cellValue2String(cellValue?: ILinkCellValue | ILinkCellValue[]) {
    if (Array.isArray(cellValue)) {
      return cellValue.map((v) => v.title || '').join(', ');
    }
    return cellValue ? cellValue.title ?? '' : '';
  }

  convertStringToCellValue(_value: string): string[] | null {
    return null;
  }

  repair(value: unknown) {
    return value;
  }

  validateOptions() {
    if (this.isLookup) {
      return z.null().optional().safeParse(this.options);
    }
    return linkFieldOptionsDef.safeParse(this.options);
  }

  validateDefaultValue() {
    return z.null().optional().safeParse(this.defaultValue);
  }
}
