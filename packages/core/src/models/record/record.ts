import { z } from 'zod';
import { IdPrefix } from '../../utils';
import type { FieldCore } from '../field/field';

export enum FieldKeyType {
  Id = 'id',
  Name = 'name',
  DbFieldName = 'dbFieldName',
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

  id!: string;

  isDeleted = false;

  fields!: Record<string, unknown>;

  permissions?: Record<'read' | 'update', Record<string, boolean>>;

  undeletable?: boolean;

  getCellValue(fieldId: string): unknown {
    return this.fields[fieldId];
  }

  getCellValueAsString(fieldId: string) {
    return this.fieldMap[fieldId].cellValue2String(this.fields[fieldId]);
  }
}

export const recordSchema = z.object({
  id: z.string().startsWith(IdPrefix.Record).openapi({
    description: 'The record id.',
  }),
  name: z.string().optional().openapi({ description: 'primary field value' }),
  fields: z.record(z.unknown()).openapi({
    description: 'Objects with a fields key mapping fieldId or field name to value for that field.',
  }),
  autoNumber: z.number().optional().openapi({
    description: 'Auto number, a unique identifier for each record',
  }),
  createdTime: z.string().optional().openapi({
    description: 'Created time, date ISO string (new Date().toISOString).',
  }),
  lastModifiedTime: z.string().optional().openapi({
    description: 'Last modified time, date ISO string (new Date().toISOString).',
  }),
  createdBy: z.string().optional().openapi({
    description: 'Created by, user name',
  }),
  lastModifiedBy: z.string().optional().openapi({
    description: 'Last modified by, user name',
  }),
  permissions: z.record(z.string(), z.record(z.string(), z.boolean())).optional().openapi({
    description: 'Permissions for the record',
  }),
  undeletable: z.boolean().optional().openapi({
    description: 'Whether the record is undeletable',
  }),
});

export type IRecord = z.infer<typeof recordSchema>;
