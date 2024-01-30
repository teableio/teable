import { FieldType } from '@teable/core';

/* eslint-disable @typescript-eslint/naming-convention */
export interface IVisualTableDefaultField {
  __id: string;
  __version: number;
  __auto_number: number;
  __created_time: Date;
  __last_modified_time?: Date;
  __created_by: string;
  __last_modified_by?: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

export const preservedDbFieldNames = new Set([
  '__id',
  '__version',
  '__auto_number',
  '__created_time',
  '__last_modified_time',
  '__created_by',
  '__last_modified_by',
]);

export const systemDbFieldNames = new Set([
  '__id',
  '__auto_number',
  '__created_time',
  '__last_modified_time',
  '__created_by',
  '__last_modified_by',
]);

export const systemFieldTypes = new Set([
  FieldType.AutoNumber,
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
]);
