import type { StatisticsFunc } from '../view';
import type { FieldType } from './constant';
export class FieldBase {
  id!: string;
  name!: string;
  type!: FieldType;
  description?: string;
  options?: unknown;
  notNull?: boolean;
  unique?: boolean;
  isPrimary?: boolean;
  defaultValue?: unknown;
}

export class Column {
  order!: number;
  width?: number;
  hidden?: boolean;
  statisticFunc?: StatisticsFunc;
}

export enum CellValueType {
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  Datetime = 'datetime',
  Array = 'array',
}

export abstract class Field extends FieldBase {
  abstract type: FieldType;

  abstract options?: unknown;

  abstract defaultValue?: unknown;

  // for lookup field, it is a dynamic value
  abstract calculatedType: unknown;

  // cellValue type enum (string, number, boolean, datetime, array)
  abstract cellValueType: CellValueType;
}
