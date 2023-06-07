import type { SafeParseReturnType } from 'zod';
import type { StatisticsFunc } from '../view';
import type { CellValueType, DbFieldType, FieldType } from './constant';
import type { IColumnMeta } from './interface';
export interface IFieldRo {
  name: string;
  type: FieldType;
  icon?: string;
  description?: string;
  options?: unknown;
  notNull?: boolean;
  unique?: boolean;
  isPrimary?: boolean;
  defaultValue?: unknown;
}

export interface IFieldVo extends IFieldRo {
  id: string;
  isComputed?: boolean;
  calculatedType: FieldType;
  cellValueType: CellValueType;
  cellValueElementType?: CellValueType;
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

  abstract isComputed?: boolean;

  abstract dbFieldType: DbFieldType;

  abstract options?: unknown;

  abstract defaultValue?: unknown;

  // for lookup field, it is a dynamic value
  abstract calculatedType: FieldType;

  // cellValue type enum (string, number, boolean, datetime, array)
  abstract cellValueType: CellValueType;

  // cellValue array element type enum (string, number, boolean, datetime)
  cellValueElementType?: CellValueType;

  abstract cellValue2String(value?: unknown): string;

  abstract convertStringToCellValue(str: string): unknown;

  // try parse cellValue and fix it
  abstract repair(value: unknown): unknown;

  abstract validateOptions(): SafeParseReturnType<unknown, unknown> | undefined;

  abstract validateDefaultValue(): SafeParseReturnType<unknown, unknown> | undefined;
}
