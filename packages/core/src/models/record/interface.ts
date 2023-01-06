export interface IRecord {
  id: string;
  createdTime: number;
  lastModifiedTime: number;
  createdBy: string;
  lastModifiedBy: string;
  fields: IRecordFields;
}

export interface IRecordFields {
  [fieldId: string]: unknown;
}

export interface IRecordSnapshot {
  record: IRecord;
  recordOrder: { [viewId: string]: number };
}
