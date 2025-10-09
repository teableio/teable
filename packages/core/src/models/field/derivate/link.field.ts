import { IdPrefix } from '../../../utils';
import { z } from '../../../zod';
import type { TableDomain } from '../../table/table-domain';
import type { IFilter } from '../../view/filter/filter';
import { type CellValueType, FieldType, Relationship } from '../constant';
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

  override get isStructuredCellValue() {
    return true;
  }

  type!: FieldType.Link;

  options!: ILinkFieldOptions;

  declare meta?: ILinkFieldMeta;

  cellValueType!: CellValueType.String;

  declare isMultipleCellValue?: boolean | undefined;

  getHasOrderColumn(): boolean {
    return !!this.meta?.hasOrderColumn;
  }

  /**
   * Get the order column name for this link field based on its relationship type
   * @returns The order column name to use in database queries and operations
   */
  getOrderColumnName(): string {
    const relationship = this.options.relationship;

    switch (relationship) {
      case Relationship.ManyMany:
        // ManyMany relationships use a simple __order column in the junction table
        return '__order';

      case Relationship.OneMany:
        // OneMany relationships use the selfKeyName (foreign key in target table) + _order
        return `${this.options.selfKeyName}_order`;

      case Relationship.ManyOne:
      case Relationship.OneOne:
        // ManyOne and OneOne relationships use the foreignKeyName (foreign key in current table) + _order
        return `${this.options.foreignKeyName}_order`;

      default:
        throw new Error(`Unsupported relationship type: ${relationship}`);
    }
  }

  getIsMultiValue() {
    const relationship = this.options.relationship;
    return relationship === Relationship.ManyMany || relationship === Relationship.OneMany;
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
   * @param foreignTable - The table domain to search for the lookup field
   * @override
   * @returns The lookup field instance if found and table IDs match
   */
  override getForeignLookupField(foreignTable: TableDomain): FieldCore | undefined {
    if (this.isLookup) {
      return super.getForeignLookupField(foreignTable);
    }

    // Ensure the foreign table ID matches the provided table domain ID
    if (this.options.foreignTableId !== foreignTable.id) {
      return undefined;
    }

    // Get the lookup field ID from options
    const lookupFieldId = this.options.lookupFieldId;
    if (!lookupFieldId) {
      return undefined;
    }

    // Get the lookup field instance from the table domain
    return foreignTable.getField(lookupFieldId);
  }

  mustGetForeignLookupField(tableDomain: TableDomain): FieldCore {
    const field = this.getForeignLookupField(tableDomain);
    if (!field) {
      throw new Error(`Lookup field ${this.options.lookupFieldId} not found`);
    }
    return field;
  }

  getLookupFields(tableDomain: TableDomain) {
    return tableDomain.filterFields(
      (field) =>
        !!field.isLookup &&
        !!field.lookupOptions &&
        'linkFieldId' in field.lookupOptions &&
        field.lookupOptions.linkFieldId === this.id
    );
  }

  getRollupFields(tableDomain: TableDomain) {
    return tableDomain.filterFields(
      (field) =>
        field.type === FieldType.Rollup &&
        !!field.lookupOptions &&
        'linkFieldId' in field.lookupOptions &&
        field.lookupOptions.linkFieldId === this.id
    );
  }

  override getFilter(): IFilter | undefined {
    return this.options?.filter ?? undefined;
  }
}
