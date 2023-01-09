import type { IFieldBase } from './interface';

export enum CellValueType {
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  Datetime = 'datetime',
  Array = 'array',
}

export abstract class Field {
  constructor(public readonly data: IFieldBase) {}

  get name() {
    return this.data.name;
  }

  get isPrimary() {
    return this.data.isPrimary;
  }

  abstract get type(): unknown;

  abstract get defaultValue(): unknown;

  // for lookup field, it is a dynamic value
  abstract get calculatedType(): unknown;

  // cellValue type enum (string, number, boolean, datetime, array)
  abstract get cellValueType(): CellValueType;
}
