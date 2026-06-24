import type { ZodSafeParseResult } from 'zod';
import { ZodError } from 'zod';
import type { TableDomain } from '../table';
import type { IFilter } from '../view/filter';
import { CellValueType } from './constant';
import type { DbFieldType, FieldType } from './constant';
import type { LinkFieldCore } from './derivate/link.field';
import type { IFieldVisitor } from './field-visitor.interface';
import type { IFieldVo } from './field.schema';
import type { IConditionalLookupOptions, ILookupOptionsVo } from './lookup-options-base.schema';
import { getDbFieldType } from './utils/get-db-field-type';

export interface IFieldMatchSearchOptions {
  isSearchAllFields?: boolean;
}

export abstract class FieldCore implements IFieldVo {
  id!: string;

  name!: string;

  description?: string;

  notNull?: boolean;

  unique?: boolean;

  isPrimary?: boolean;

  dbFieldName!: string;

  get dbFieldNames() {
    return [this.dbFieldName];
  }

  aiConfig?: IFieldVo['aiConfig'];

  abstract type: FieldType;

  isComputed?: boolean;

  isPending?: boolean;

  hasError?: boolean;

  dbFieldType!: DbFieldType;

  abstract options: IFieldVo['options'];

  abstract meta?: IFieldVo['meta'];

  // cellValue type enum (string, number, boolean, datetime)
  abstract cellValueType: CellValueType;

  // if cellValue multiple
  // every field need to consider to support multiple cellValue, because lookup value may be multiple
  isMultipleCellValue?: boolean;

  // if this field is lookup field
  isLookup?: boolean;

  // indicates lookup field applies conditional filtering when resolving values
  isConditionalLookup?: boolean;

  lookupOptions?: ILookupOptionsVo;

  /**
   * Whether this field is full read record denied.
   */
  recordRead?: boolean;

  /**
   * Whether this field is full create record denied.
   */
  recordCreate?: boolean;

  /**
   * some field may store a json type item, we need to know how to convert it to string
   * it has those difference between cellValue2String
   * item is the fundamental element of a cellValue, but cellValue may be a Array
   * example a link cellValue: [{title: 'A1', id: 'rec1'}, {title: 'A2', id: 'rec2'}]
   * in this case, {title: 'A1', id: 'rec1'} is the item in cellValue.
   *
   * caution:
   * this function should handle the case that item is undefined
   */
  abstract item2String(value?: unknown): string;

  abstract cellValue2String(value?: unknown): string;

  /**
   * Whether this field participates in search for the given keyword. The
   * backend (record.service getSearchFields) uses this same predicate to
   * pick search fields, so server-side searching and client-side highlighting
   * cannot drift apart. The shared rules key on cellValueType so that
   * computed fields (formula/rollup/lookup) follow them automatically:
   * boolean cells are never searchable; an all-fields search additionally
   * skips datetime cells and number cells when the keyword is not numeric.
   * Field types with type-specific behavior (e.g. button) override this.
   */
  isSearchable(searchValue: string, options?: IFieldMatchSearchOptions): boolean {
    if (this.cellValueType === CellValueType.Boolean) return false;
    if (options?.isSearchAllFields) {
      if (this.cellValueType === CellValueType.DateTime) return false;
      if (this.cellValueType === CellValueType.Number && isNaN(Number(searchValue))) return false;
    }
    return true;
  }

  /**
   * Whether the cell value matches a search keyword: a case-insensitive
   * substring test against the cell display text, gated by isSearchable.
   * Multi-value cells match per item — backend SQL never matches across
   * element boundaries of the joined display text.
   */
  matchSearch(
    cellValue: unknown,
    searchValue: string,
    options?: IFieldMatchSearchOptions
  ): boolean {
    if (!this.isSearchable(searchValue, options)) return false;
    if (cellValue == null || !searchValue) return false;
    const needle = searchValue.toLowerCase();
    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.some((item) => this.item2String(item).toLowerCase().includes(needle));
    }
    return this.cellValue2String(cellValue).toLowerCase().includes(needle);
  }

  abstract convertStringToCellValue(str: string, ctx?: unknown): unknown;

  /**
   * try parse cellValue as possible as it can
   * if not match it would return null
   * * computed field is always return null
   */
  abstract repair(value: unknown): unknown;

  abstract validateOptions(): ZodSafeParseResult<unknown> | undefined;

  abstract validateCellValue(value: unknown): ZodSafeParseResult<unknown> | undefined;

  /**
   * Wrapper to enforce notNull when calling validateCellValue.
   */
  validateCellValueWithNotNull(value: unknown): ZodSafeParseResult<unknown> | undefined {
    if (this.isComputed) {
      return this.validateCellValue(value);
    }
    if (this.notNull && (value === null || value === undefined)) {
      return {
        success: false,
        error: new ZodError([
          {
            code: 'custom',
            message: 'Required',
            path: [],
          },
        ]),
      };
    }
    return this.validateCellValue(value);
  }

  /**
   * Updates the dbFieldType based on the current field type, cellValueType, and isMultipleCellValue
   */
  updateDbFieldType(): void {
    this.dbFieldType = getDbFieldType(this.type, this.cellValueType, this.isMultipleCellValue);
  }

  /**
   * Accept method for the Visitor pattern.
   * Each concrete field type should implement this method to call the appropriate visitor method.
   *
   * @param visitor The visitor instance
   * @returns The result of the visitor method call
   */
  abstract accept<T>(visitor: IFieldVisitor<T>): T;

  getForeignLookupField(foreignTable: TableDomain): FieldCore | undefined {
    const lookupFieldId = this.lookupOptions?.lookupFieldId;
    if (!lookupFieldId) {
      return undefined;
    }

    return foreignTable.getField(lookupFieldId);
  }

  mustGetForeignLookupField(foreignTable: TableDomain): FieldCore {
    const field = this.getForeignLookupField(foreignTable);
    if (!field) {
      throw new Error(`Lookup field ${this.lookupOptions?.lookupFieldId} not found`);
    }
    return field;
  }

  getLinkField(table: TableDomain): LinkFieldCore | undefined {
    const options = this.lookupOptions;
    if (!options || !('linkFieldId' in options)) {
      return undefined;
    }
    const linkFieldId = options.linkFieldId;
    return table.getField(linkFieldId) as LinkFieldCore | undefined;
  }

  getLinkFields(table: TableDomain): LinkFieldCore[] {
    const linkField = this.getLinkField(table);
    if (!linkField) {
      return [];
    }
    return [linkField];
  }

  get isStructuredCellValue(): boolean {
    return false;
  }

  getConditionalLookupOptions(): IConditionalLookupOptions | undefined {
    if (!this.isConditionalLookup) {
      return undefined;
    }

    const options = this.lookupOptions;
    if (!options || 'linkFieldId' in options) {
      return undefined;
    }

    return options as IConditionalLookupOptions;
  }

  /**
   * Returns the filter configured on this field's lookup options, if any.
   */
  getFilter(): IFilter | undefined {
    return this.lookupOptions?.filter ?? undefined;
  }
}
