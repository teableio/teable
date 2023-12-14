import type { FieldCore } from '../field/field';
import type { IRecord } from './record.schema';

export enum FieldKeyType {
  Id = 'id',
  Name = 'name',
}

export enum CellFormat {
  Json = 'json',
  Text = 'text',
}

export class RecordCore {
  constructor(protected fieldMap: { [fieldId: string]: FieldCore }) {}

  name?: string;

  commentCount!: number;

  createdTime!: Date;

  recordOrder!: Record<string, number>;

  id!: string;

  isDeleted = false;

  fields!: IRecord['fields'];

  getCellValue(fieldId: string): unknown {
    return this.fields[fieldId];
  }

  getCellValueAsString(fieldId: string) {
    return this.fieldMap[fieldId].cellValue2String(this.fields[fieldId]);
  }
}
