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
  record: Pick<IRecord, 'id' | 'fields'> & Partial<IRecord>;
  recordOrder: { [viewId: string]: number };
}
