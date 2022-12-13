export enum DbFieldType {
  Text = 'TEXT',
  Integer = 'INTEGER',
  Real = 'REAL',
  Blob = 'BLOB',
}

export const preservedFieldName = new Set([
  '__id',
  '__autonumber',
  '__createdAt',
  '__updatedAt',
  '__createBy',
  '__updateBy',
]);
