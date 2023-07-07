import type { CellFormat, FieldKeyType } from './record';

export interface IRecord {
  id: string;
  fields: IRecordFields;
  createdTime?: string;
  lastModifiedTime?: string;
  createdBy?: string;
  lastModifiedBy?: string;
  recordOrder: { [viewId: string]: number };
}

export interface IRecordFields {
  [fieldId: string]: unknown;
}

export interface IRecordSnapshot {
  record: IRecord;
}

export interface ICreateRecordsRo {
  fieldKeyType?: FieldKeyType;

  records: {
    fields: { [fieldIdOrName: string]: unknown };
  }[];
}

export interface IUpdateRecordRo {
  fieldKeyType?: FieldKeyType;

  record: {
    fields: { [fieldIdOrName: string]: unknown };
  };
}

export interface IUpdateRecordByIndexRo extends IUpdateRecordRo {
  viewId: string;
  index: number;
}

export interface IRecordVo {
  record: IRecord;
}

export interface IRecordsVo {
  records: IRecord[];

  total: number;
}

export interface IRecordsRo extends IRecordRo {
  take?: number;

  skip?: number;

  recordIds?: string[];

  viewId?: string;
}

export interface IRecordRo {
  cellFormat?: CellFormat;

  fieldKeyType?: FieldKeyType;

  projection?: { [fieldNameOrId: string]: boolean };
}
