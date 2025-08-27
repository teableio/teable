import { IdPrefix } from '../../../utils';
import { z } from '../../../zod';
import { filterSchema } from '../../view/filter';
import type { FieldType, CellValueType } from '../constant';
import { Relationship } from '../constant';
import { FieldCore } from '../field';

export const linkFieldOptionsSchema = z
  .object({
    baseId: z.string().optional().openapi({
      description:
        'the base id of the table that this field is linked to, only required for cross base link',
    }),
    relationship: z.nativeEnum(Relationship).openapi({
      description: 'describe the relationship from this table to the foreign table',
    }),
    foreignTableId: z.string().openapi({
      description: 'the table this field is linked to',
    }),
    lookupFieldId: z.string().openapi({
      description: 'the field in the foreign table that will be displayed as the current field',
    }),
    isOneWay: z.boolean().optional().openapi({
      description:
        'whether the field is a one-way link, when true, it will not generate a symmetric field, it is generally has better performance',
    }),
    fkHostTableName: z.string().openapi({
      description:
        'the table name for storing keys, in many-to-many relationships, keys are stored in a separate intermediate table; in other relationships, keys are stored on one side as needed',
    }),
    selfKeyName: z.string().openapi({
      description: 'the name of the field that stores the current table primary key',
    }),
    foreignKeyName: z.string().openapi({
      description: 'The name of the field that stores the foreign table primary key',
    }),
    symmetricFieldId: z.string().optional().openapi({
      description: 'the symmetric field in the foreign table, empty if the field is a one-way link',
    }),
    filterByViewId: z.string().nullable().optional().openapi({
      description: 'the view id that limits the number of records in the link field',
    }),
    visibleFieldIds: z.array(z.string()).nullable().optional().openapi({
      description: 'the fields that will be displayed in the link field',
    }),
    filter: filterSchema.optional(),
  })
  .strip();

export type ILinkFieldOptions = z.infer<typeof linkFieldOptionsSchema>;

export const linkFieldOptionsRoSchema = linkFieldOptionsSchema
  .pick({
    baseId: true,
    relationship: true,
    foreignTableId: true,
    isOneWay: true,
    filterByViewId: true,
    visibleFieldIds: true,
    filter: true,
  })
  .merge(
    z.object({
      lookupFieldId: z
        .string()
        .optional()
        .describe(
          'Link field will display the value of this field from the foreign table, if not provided, it will use the primary field of the foreign table, in common case you can safely ignore it'
        ),
    })
  );

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
