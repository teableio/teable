import type { IRecordSnapshot } from '@teable-group/core';
import type { Doc } from '@teable/sharedb/lib/client';
import { plainToInstance } from 'class-transformer';
import type { IFieldInstance } from '../field';
import { Record } from './record';

export function createRecordInstance(
  recordSnapshot: IRecordSnapshot,
  doc?: Doc<IRecordSnapshot>,
  fieldMap?: { [fieldId: string]: IFieldInstance }
) {
  const instance = plainToInstance(Record, { ...recordSnapshot.record, fieldMap });
  // force inject object into instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: any = instance;
  temp.doc = doc;
  return instance;
}

export function recordInstanceFieldMap(
  instance: Record,
  fieldMap: { [fieldId: string]: IFieldInstance }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: any = instance;
  temp.fieldMap = fieldMap;
  return instance;
}
