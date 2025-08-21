import { IdPrefix } from '../../../utils';
import { z } from '../../../zod';
import type { TableDomain } from '../../table/table-domain';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
import {
  linkFieldOptionsSchema,
  type ILinkFieldOptions,
  type ILinkFieldMeta,
} from './link-option.schema';

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

  declare meta?: ILinkFieldMeta;

  cellValueType!: CellValueType.String;

  declare isMultipleCellValue?: boolean | undefined;

  getHasOrderColumn(): boolean {
    return this.meta?.hasOrderColumn || false;
  }

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

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitLinkField(this);
  }

  /**
   * Get the foreign table ID that this link field references
   */
  getForeignTableId(): string | undefined {
    return this.options.foreignTableId;
  }

  /**
   * Get the lookup field from the foreign table
   * @param tableDomain - The table domain to search for the lookup field
   * @returns The lookup field instance if found and table IDs match
   */
  getForeignLookupField(tableDomain: TableDomain): FieldCore | undefined {
    // Ensure the foreign table ID matches the provided table domain ID
    if (this.options.foreignTableId !== tableDomain.id) {
      return undefined;
    }

    // Get the lookup field ID from options
    const lookupFieldId = this.options.lookupFieldId;
    if (!lookupFieldId) {
      return undefined;
    }

    // Get the lookup field instance from the table domain
    return tableDomain.getField(lookupFieldId);
  }
}
