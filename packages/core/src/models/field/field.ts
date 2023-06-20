import type { SafeParseReturnType } from 'zod';
import type { StatisticsFunc } from '../view';
import type { CellValueType, DbFieldType, FieldType } from './constant';
import type { Relationship } from './derivate';
import type { IColumnMeta } from './interface';

export class LookupOptions {
  foreignTableId!: string;
  linkFieldId!: string;
  lookupFieldId!: string;
  relationShip?: Relationship;
}

export class LookupOptionsVo {
  foreignTableId!: string;
  linkFieldId!: string;
  lookupFieldId!: string;
  relationShip!: Relationship;
}

export interface IFieldRo {
  name: string;
  type: FieldType;
  icon?: string;
  description?: string;
  options?: unknown;
  isLookup?: boolean;
  lookupOptions?: LookupOptions;
  notNull?: boolean;
  unique?: boolean;
  isPrimary?: boolean;
  defaultValue?: unknown;
  columnMeta?: IColumnMeta;
}

export interface IFieldVo extends IFieldRo {
  id: string;
  isComputed?: boolean;
  cellValueType: CellValueType;
  isMultipleCellValue?: boolean;
  lookupOptions?: LookupOptionsVo;
  dbFieldType: DbFieldType;
  dbFieldName: string;
  columnMeta: IColumnMeta;
}

export class Column {
  order!: number;
  width?: number;
  hidden?: boolean;
  statisticFunc?: StatisticsFunc;
}

export abstract class FieldCore implements IFieldVo {
  id!: string;

  name!: string;

  description?: string;

  notNull?: boolean;

  unique?: boolean;

  isPrimary?: boolean;

  columnMeta!: IColumnMeta;

  dbFieldName!: string;

  abstract type: FieldType;

  isComputed?: boolean;

  dbFieldType!: DbFieldType;

  abstract options?: unknown;

  abstract defaultValue?: unknown;

  // cellValue type enum (string, number, boolean, datetime)
  abstract cellValueType: CellValueType;

  // if cellValue multiple
  // every field need to consider to support multiple cellValue, because lookup value may be multiple
  isMultipleCellValue?: boolean;

  // if this field is lookup field
  isLookup?: boolean;

  lookupOptions?: LookupOptionsVo;

  abstract cellValue2String(value?: unknown): string;

  abstract convertStringToCellValue(str: string): unknown;

  // try parse cellValue and fix it
  abstract repair(value: unknown): unknown;

  abstract validateOptions(): SafeParseReturnType<unknown, unknown> | undefined;

  abstract validateDefaultValue(): SafeParseReturnType<unknown, unknown> | undefined;
}
