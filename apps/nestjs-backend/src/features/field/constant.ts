import { FieldType } from '@teable/core';

export const ID_FIELD_NAME = '__id';
export const VERSION_FIELD_NAME = '__version';
export const AUTO_NUMBER_FIELD_NAME = '__auto_number';
export const CREATED_TIME_FIELD_NAME = '__created_time';
export const LAST_MODIFIED_TIME_FIELD_NAME = '__last_modified_time';
export const CREATED_BY_FIELD_NAME = '__created_by';
export const LAST_MODIFIED_BY_FIELD_NAME = '__last_modified_by';

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
  ID_FIELD_NAME,
  VERSION_FIELD_NAME,
  AUTO_NUMBER_FIELD_NAME,
  CREATED_TIME_FIELD_NAME,
  LAST_MODIFIED_TIME_FIELD_NAME,
  CREATED_BY_FIELD_NAME,
  LAST_MODIFIED_BY_FIELD_NAME,
]);

export const systemDbFieldNames = new Set([
  ID_FIELD_NAME,
  AUTO_NUMBER_FIELD_NAME,
  CREATED_TIME_FIELD_NAME,
  LAST_MODIFIED_TIME_FIELD_NAME,
  CREATED_BY_FIELD_NAME,
  LAST_MODIFIED_BY_FIELD_NAME,
]);

export const systemFieldTypes = new Set([
  FieldType.AutoNumber,
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
]);
