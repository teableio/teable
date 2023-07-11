import type { SafeParseReturnType } from 'zod';
import { z } from 'zod';
import type { StatisticsFunc } from '../view';
import type { CellValueType, DbFieldType, FieldType } from './constant';
import { Relationship } from './derivate';
import type { IColumnMeta } from './interface';

export const lookupOptionsRoDef = z.object({
  foreignTableId: z.string(),
  linkFieldId: z.string(),
  lookupFieldId: z.string(),
  relationship: z.nativeEnum(Relationship).optional(),
  dbForeignKeyName: z.string().optional(),
  symmetricFieldId: z.string().optional(),
});

export type ILookupOptions = z.infer<typeof lookupOptionsRoDef>;

export const lookupOptionsVoDef = lookupOptionsRoDef.merge(
  z.object({
    relationship: z.nativeEnum(Relationship),
    dbForeignKeyName: z.string(),
    symmetricFieldId: z.string(),
  })
);

export type ILookupOptionsVo = z.infer<typeof lookupOptionsVoDef>;

export interface IFieldRo {
  name: string;
  type: FieldType;
  icon?: string;
  description?: string;
  options?: unknown;
  isLookup?: boolean;
  lookupOptions?: ILookupOptions;
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
  lookupOptions?: ILookupOptionsVo;
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

  lookupOptions?: ILookupOptionsVo;

  abstract cellValue2String(value?: unknown): string;

  abstract convertStringToCellValue(str: string): unknown;

  // try parse cellValue and fix it
  abstract repair(value: unknown): unknown;

  abstract validateOptions(): SafeParseReturnType<unknown, unknown> | undefined;

  abstract validateDefaultValue(): SafeParseReturnType<unknown, unknown> | undefined;
}
