import type { FieldCore } from '../field';
import type { IRecordFields } from './interface';

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

  commentCount!: number;

  createdTime!: Date;

  id!: string;

  isDeleted = false;

  name!: string;

  fields!: IRecordFields;

  getCellValue(fieldId: string): unknown {
    return this.fields[fieldId];
  }

  getCellValueAsString(fieldId: string) {
    this.fieldMap[fieldId].cellValue2String(this.fields[fieldId]);
  }
}
