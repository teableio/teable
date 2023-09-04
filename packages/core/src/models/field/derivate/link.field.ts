import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import type { FieldType, CellValueType } from '../constant';
import { Relationship } from '../constant';
import { FieldCore } from '../field';

export const linkFieldOptionsSchema = z
  .object({
    relationship: z.nativeEnum(Relationship).openapi({
      description: 'describe the relationship from this table to the foreign table',
    }),
    foreignTableId: z.string().openapi({
      description: 'the table this field is linked to',
    }),
    lookupFieldId: z.string().openapi({
      description: 'the field in the foreign table that will be displayed as the current field',
    }),
    dbForeignKeyName: z.string().openapi({
      description: 'the foreign key field name used to store values in the db table',
    }),
    symmetricFieldId: z.string().openapi({
      description: 'the symmetric field in the foreign table',
    }),
  })
  .strict();

export type ILinkFieldOptions = z.infer<typeof linkFieldOptionsSchema>;

export const linkFieldOptionsRoSchema = linkFieldOptionsSchema
  .pick({
    relationship: true,
    foreignTableId: true,
  })
  .strict();

export type ILinkFieldOptionsRo = z.infer<typeof linkFieldOptionsRoSchema>;

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

  cellValue2String(cellValue?: unknown) {
    if (Array.isArray(cellValue)) {
      return cellValue.map((v) => this.item2String(v)).join(', ');
    }
    return this.item2String(cellValue);
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

  item2String(value: unknown) {
    if (value == null) {
      return '';
    }
    return (value as { title?: string }).title || '';
  }
}
