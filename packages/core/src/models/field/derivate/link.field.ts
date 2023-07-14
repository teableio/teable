import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import type { FieldType, CellValueType } from '../constant';
import { Relationship } from '../constant';
import { FieldCore } from '../field';

export const linkFieldOptionsSchema = z.object({
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

export type ILinkFieldOptions = z.infer<typeof linkFieldOptionsSchema>;

export type ILinkFieldOptionsRo = Pick<ILinkFieldOptions, 'relationship' | 'foreignTableId'>;

export const linkCellValueSchema = z.object({
  id: z.string().startsWith(IdPrefix.Record),
  title: z.string().optional(),
});

export type ILinkCellValue = z.infer<typeof linkCellValueSchema>;

export class LinkFieldCore extends FieldCore {
  static defaultOptions(): Partial<ILinkFieldOptions> {
    return {};
  }

  type!: FieldType.Link;

  options!: ILinkFieldOptions;

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
    if (this.isLookup) {
      return null;
    }

    if (this.validateCellValue(value).success) {
      return value;
    }
    return null;
  }

  validateOptions() {
    return linkFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(linkCellValueSchema).nonempty().nullable().safeParse(value);
    }

    return linkCellValueSchema.nullable().safeParse(value);
  }
}
