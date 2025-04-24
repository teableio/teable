import type { SafeParseReturnType } from 'zod';
import type { CellValueType, DbFieldType, FieldType } from './constant';
import type { IFieldVo, ILookupOptionsVo } from './field.schema';

export abstract class FieldCore implements IFieldVo {
  id!: string;

  name!: string;

  description?: string;

  notNull?: boolean;

  unique?: boolean;

  isPrimary?: boolean;

  dbFieldName!: string;

  aiConfig?: IFieldVo['aiConfig'];

  abstract type: FieldType;

  isComputed?: boolean;

  isPending?: boolean;

  hasError?: boolean;

  dbFieldType!: DbFieldType;

  abstract options: IFieldVo['options'];

  // cellValue type enum (string, number, boolean, datetime)
  abstract cellValueType: CellValueType;

  // if cellValue multiple
  // every field need to consider to support multiple cellValue, because lookup value may be multiple
  isMultipleCellValue?: boolean;

  // if this field is lookup field
  isLookup?: boolean;

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

  abstract convertStringToCellValue(str: string, ctx?: unknown): unknown;

  /**
   * try parse cellValue as possible as it can
   * if not match it would return null
   * * computed field is always return null
   */
  abstract repair(value: unknown): unknown;

  abstract validateOptions(): SafeParseReturnType<unknown, unknown> | undefined;

  abstract validateCellValue(value: unknown): SafeParseReturnType<unknown, unknown> | undefined;
}
